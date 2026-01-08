import type { RequestHandler } from "express";
import type { RequestWithContext } from "../../../../shared/types/api";
import { AppError } from "../../../../shared/utils/errors";
import { auditLog } from "../../../../platform/gateway/src/core/audit/auditService";
import { withRequestContext } from "../../../../platform/gateway/src/db/pg";
import { embedQuery } from "../services/ingest/embed";
import { resolveTenantScope } from "../services/retrieval/tenantScope";
import { vectorSearch } from "../services/retrieval/vectorSearch";
import { getChunksByIds } from "../services/ro/chunkRepo";
import { getRosByIds } from "../services/ro/roRepo";
import { classifyIntent } from "../services/retrieval/intentClassifier";
import { redactPII } from "../services/retrieval/redactPii";
import { parseRoNumbers } from "../services/retrieval/roNumberLookup";
import {
  fetchDeterministicLookup,
  fetchDeterministicCost,
  fetchDeterministicCount
} from "../services/retrieval/deterministicLookup";
import {
  determineRetrievalStrategy,
  type RetrievalStrategy,
  applyDirectLookupFallback,
  shouldBypassRetrieval
} from "../services/retrieval/retrievalStrategy";

type SearchBody = {
  query: string;
  top_k?: number;
};

export const searchHandler: RequestHandler = async (req, res) => {
  const ctx = (req as RequestWithContext).context;
  if (!ctx?.role || !ctx?.tenantId || !ctx?.userId || !ctx?.requestId) {
    const error = new AppError("Missing request context", { status: 400, code: "CTX_MISSING" });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }
  if (
    ctx.role !== "USER" &&
    ctx.role !== "ADMIN" &&
    ctx.role !== "DEALERADMIN" &&
    ctx.role !== "DEVELOPER"
  ) {
    const error = new AppError("Insufficient role", { status: 403, code: "ROLE_FORBIDDEN" });
    return res.status(error.status ?? 403).json({ error: error.code, message: error.message });
  }

  const body = req.body as SearchBody;
  if (!body?.query || typeof body.query !== "string") {
    const error = new AppError("query is required", { status: 400, code: "BAD_REQUEST" });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  const topK = body.top_k && body.top_k > 0 ? Math.min(body.top_k, 5) : 3;
  const intent = await classifyIntent(body.query);
  await auditLog(ctx, {
    action: "INTENT_CLASSIFY",
    object_type: "search_query",
    metadata: {
      intent: intent.intent,
      confidence: intent.confidence,
      source: intent.source
    }
  });

  if (shouldBypassRetrieval(intent.intent)) {
    await auditLog(ctx, {
      action: "RETRIEVAL_STRATEGY",
      object_type: "search_query",
      metadata: {
        intent: intent.intent,
        confidence: intent.confidence,
        strategy: "NONE",
        fallback: false
      }
    });
    return res.status(200).json({ matches: [] });
  }

  const initialStrategy = determineRetrievalStrategy(intent.intent, intent.confidence);
  let retrievalStrategy: RetrievalStrategy = initialStrategy;
  let fallbackTriggered = false;

  let matchesWithCitations: Array<{
    ro_number: string | null;
    score: number;
    citations: Array<{ excerpt: string }>;
  }> = [];

  if (retrievalStrategy === "DIRECT_LOOKUP") {
    const deterministic = await withRequestContext(ctx, async (client) => {
      if (intent.intent === "lookup") {
        const rows = await fetchDeterministicLookup(client, ctx, body.query);
        return rows.map((row) => ({ ro_number: row.ro_number }));
      }
      if (intent.intent === "cost_analysis") {
        const rows = await fetchDeterministicCost(client, ctx, body.query, topK);
        return rows.map((row) => ({ ro_number: row.ro_number }));
      }
      if (intent.intent === "frequency_analysis") {
        const aggregate = await fetchDeterministicCount(client, ctx, body.query);
        return aggregate ? [] : [];
      }
      return [];
    });
    matchesWithCitations = deterministic.map((row) => ({
      ro_number: row.ro_number ?? null,
      score: 1,
      citations: []
    }));
    const fallback = applyDirectLookupFallback(retrievalStrategy, matchesWithCitations.length);
    retrievalStrategy = fallback.strategy;
    fallbackTriggered = fallback.fallbackTriggered;
    if (!fallbackTriggered) {
      await auditLog(ctx, {
        action: "RETRIEVAL_DETERMINISTIC",
        object_type: "search_query",
        metadata: {
          intent: intent.intent,
          results: matchesWithCitations.length
        }
      });
    } else {
      await auditLog(ctx, {
        action: "RETRIEVAL_FALLBACK",
        object_type: "search_query",
        metadata: {
          intent: intent.intent,
          reason: "deterministic_empty"
        }
      });
    }
  }

  const fetchMatches = async (embedding: number[], limitOverride?: number) =>
    withRequestContext(ctx, async (client) => {
      const scope = await resolveTenantScope(client, ctx);
      const limit = limitOverride ?? topK;
      const matches = await vectorSearch(client, ctx, embedding, limit, scope.tenantIds);
      const chunkIds = matches.map((m) => m.chunk_id);
      const chunks = await getChunksByIds(client, ctx, chunkIds, scope.tenantIds);
      const roIds = Array.from(new Set(chunks.map((c) => c.ro_id)));
      const ros = await getRosByIds(client, ctx, roIds, scope.tenantIds);
      return { matches, chunks, ros };
    });

  if (retrievalStrategy === "HYBRID_SEARCH") {
    const redacted = redactPII(body.query);
    const queryEmbedding = await embedQuery(redacted);
    const { matches, chunks, ros } = await fetchMatches(queryEmbedding);
    const roNumbers = parseRoNumbers(body.query);
    const roSet = new Set(roNumbers);

    const chunkMap = new Map(chunks.map((c) => [c.chunk_id, c]));
    const roMap = new Map(ros.map((r) => [r.ro_id, r]));

    matchesWithCitations = matches.map((m) => {
      const chunk = chunkMap.get(m.chunk_id);
      const ro = chunk ? roMap.get(chunk.ro_id) : undefined;
      return {
        ro_number: ro?.ro_number ?? null,
        score: m.score,
        citations: chunk
          ? [
              {
                excerpt: chunk.chunk_text.slice(0, 400)
              }
            ]
          : []
      };
    });
    if (roNumbers.length) {
      matchesWithCitations = matchesWithCitations.filter(
        (match) => match.ro_number && roSet.has(match.ro_number)
      );
    }
  } else if (retrievalStrategy === "BROAD_VECTOR_SEARCH") {
    const redacted = redactPII(body.query);
    const queryEmbedding = await embedQuery(redacted);
    const broadTopK = Math.min(Math.max(topK, 3) + 2, 6);
    const { matches, chunks, ros } = await fetchMatches(queryEmbedding, broadTopK);

    const chunkMap = new Map(chunks.map((c) => [c.chunk_id, c]));
    const roMap = new Map(ros.map((r) => [r.ro_id, r]));

    matchesWithCitations = matches.map((m) => {
      const chunk = chunkMap.get(m.chunk_id);
      const ro = chunk ? roMap.get(chunk.ro_id) : undefined;
      return {
        ro_number: ro?.ro_number ?? null,
        score: m.score,
        citations: chunk
          ? [
              {
                excerpt: chunk.chunk_text.slice(0, 400)
              }
            ]
          : []
      };
    });
  }

  await auditLog(ctx, {
    action: "RETRIEVAL_STRATEGY",
    object_type: "search_query",
    metadata: {
      intent: intent.intent,
      confidence: intent.confidence,
      strategy: retrievalStrategy,
      fallback: fallbackTriggered
    }
  });

  return res.status(200).json({ matches: matchesWithCitations });
};
