import type { RequestHandler } from "express";
import type { RequestWithContext } from "../../../../shared/types/api";
import { randomUUID } from "crypto";
import { AppError } from "../../../../shared/utils/errors";
import { auditLog } from "../../../../platform/gateway/src/core/audit/auditService";
import { withRequestContext } from "../../../../platform/gateway/src/db/pg";
import { embedQuery } from "../services/ingest/embed";
import { resolveTenantScope } from "../services/retrieval/tenantScope";
import { vectorSearch } from "../services/retrieval/vectorSearch";
import { getChunksByIds } from "../services/ro/chunkRepo";
import { getRosByIds } from "../services/ro/roRepo";
import { buildCitedAnswer, buildDeterministicAnswer, type DeterministicAnswerResult } from "../services/retrieval/cite";
import { classifyIntent } from "../services/retrieval/intentClassifier";
import { redactPII } from "../services/retrieval/redactPii";
import { parseRoNumbers } from "../services/retrieval/roNumberLookup";
import {
  fetchDeterministicLookup,
  fetchDeterministicCost,
  fetchDeterministicCount
} from "../services/retrieval/deterministicLookup";
import {
  answerContextStore,
  buildAnswerContext,
  buildProvenanceAnswer
} from "../services/retrieval/answerContext";
import { determineAnswerTone } from "../services/retrieval/answerTone";
import {
  determineRetrievalStrategy,
  type RetrievalStrategy,
  applyDirectLookupFallback,
  shouldBypassRetrieval
} from "../services/retrieval/retrievalStrategy";

type AnswerBody = {
  question: string;
  top_k?: number;
};

export const answerHandler: RequestHandler = async (req, res) => {
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

  const body = req.body as AnswerBody;
  if (!body?.question || typeof body.question !== "string") {
    const error = new AppError("question is required", { status: 400, code: "BAD_REQUEST" });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  const topK = body.top_k && body.top_k > 0 ? Math.min(body.top_k, 5) : 3;
  const intent = await classifyIntent(body.question);
  const tone = determineAnswerTone(intent.confidence);
  const initialStrategy = determineRetrievalStrategy(intent.intent, intent.confidence);
  await auditLog(ctx, {
    action: "INTENT_CLASSIFY",
    object_type: "answer_query",
    metadata: {
      intent: intent.intent,
      confidence: intent.confidence,
      source: intent.source
    }
  });

  const contextKey = `${ctx.tenantId}:${ctx.userId}:answer`;

  if (shouldBypassRetrieval(intent.intent)) {
    const prior = answerContextStore.getLastAnswerContext(contextKey);
    if (!prior) {
      await auditLog(ctx, {
        action: "RETRIEVAL_STRATEGY",
        object_type: "answer_query",
        metadata: {
          intent: intent.intent,
          confidence: intent.confidence,
          strategy: "NONE",
          fallback: false
        }
      });
      return res.status(200).json({
        answer: "I don't have prior context for that question.",
        prompt: null,
        sources: [],
        used_llm: false
      });
    }

    await auditLog(ctx, {
      action: "PROVENANCE_QUERY",
      object_type: "answer_context",
      object_id: prior.answerId,
      metadata: {
        answer_id: prior.answerId
      }
    });

    await auditLog(ctx, {
      action: "RETRIEVAL_STRATEGY",
      object_type: "answer_query",
      metadata: {
        intent: intent.intent,
        confidence: intent.confidence,
        strategy: "NONE",
        fallback: false
      }
    });

    const provenanceAnswer = buildProvenanceAnswer(prior);
    const provenanceSources = prior.citedROs.map((ro) => ({
      ro_number: ro.roNumber,
      score: 1,
      citations: ro.evidence.map((excerpt) => ({ excerpt }))
    }));

    return res.status(200).json({
      answer: provenanceAnswer,
      prompt: null,
      sources: provenanceSources,
      used_llm: false
    });
  }

  let matchesWithCitations: Array<{
    ro_number: string | null;
    score: number;
    citations: Array<{ excerpt: string }>;
  }> = [];
  let deterministicResults = [] as Parameters<typeof buildDeterministicAnswer>[0]["results"];
  let deterministicAnswer:
    | { prompt: string; answer: string; used_llm: boolean; sources: ReturnType<typeof buildDeterministicAnswer>["sources"] }
    | null = null;

  let retrievalStrategy: RetrievalStrategy = initialStrategy;
  let fallbackTriggered = false;

  if (retrievalStrategy === "DIRECT_LOOKUP") {
    const deterministic = await withRequestContext(ctx, async (client) => {
      if (intent.intent === "lookup") {
        const rows = await fetchDeterministicLookup(client, ctx, body.question);
        return rows.map(
          (row): DeterministicAnswerResult => ({
          kind: "lookup",
          ro_number: row.ro_number,
          ro_status: row.ro_status,
          labor_total: row.labor_total,
          parts_total: row.parts_total,
          grand_total: row.grand_total,
          open_timestamp: row.open_timestamp,
          close_timestamp: row.close_timestamp
          })
        );
      }
      if (intent.intent === "cost_analysis") {
        const rows = await fetchDeterministicCost(client, ctx, body.question, topK);
        return rows.map(
          (row): DeterministicAnswerResult => ({
          kind: "cost",
          ro_number: row.ro_number,
          labor_total: row.labor_total,
          parts_total: row.parts_total,
          total: row.total
          })
        );
      }
      if (intent.intent === "frequency_analysis") {
        const aggregate = await fetchDeterministicCount(client, ctx, body.question);
        return aggregate
          ? ([{ kind: "aggregate", label: aggregate.label, value: aggregate.value }] as DeterministicAnswerResult[])
          : [];
      }
      return [];
    });
    deterministicResults = deterministic;
    matchesWithCitations = deterministic.map((row) => ({
      ro_number: row.kind === "aggregate" ? null : row.ro_number,
      score: 1,
      citations: []
    }));

    const fallback = applyDirectLookupFallback(retrievalStrategy, matchesWithCitations.length);
    retrievalStrategy = fallback.strategy;
    fallbackTriggered = fallback.fallbackTriggered;
    if (!fallbackTriggered) {
      const redactedQuestion = redactPII(body.question);
      deterministicAnswer = buildDeterministicAnswer({
        question: redactedQuestion,
        results: deterministicResults
      });
      await auditLog(ctx, {
        action: "RETRIEVAL_DETERMINISTIC",
        object_type: "answer_query",
        metadata: {
          intent: intent.intent,
          results: deterministicResults.length
        }
      });
    } else {
      await auditLog(ctx, {
        action: "RETRIEVAL_FALLBACK",
        object_type: "answer_query",
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
    const redacted = redactPII(body.question);
    const queryEmbedding = await embedQuery(redacted);

    const { matches, chunks, ros } = await fetchMatches(queryEmbedding);
    const roNumbers = parseRoNumbers(body.question);
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
    const redacted = redactPII(body.question);
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
    object_type: "answer_query",
    metadata: {
      intent: intent.intent,
      confidence: intent.confidence,
      strategy: retrievalStrategy,
      fallback: fallbackTriggered
    }
  });

  const redactedQuestion = redactPII(body.question);
  const answerPayload =
    deterministicAnswer ??
    (await buildCitedAnswer(
      {
        question: redactedQuestion,
        matches: matchesWithCitations
      },
      tone
    ));

  if (deterministicAnswer?.sources?.length) {
    matchesWithCitations = deterministicAnswer.sources.map((source) => ({
      ro_number: source.ro_number ?? null,
      score: 1,
      citations: [
        {
          excerpt: `deterministic:${source.table}${source.ro_number ? ` ro_number=${source.ro_number}` : ""}${
            source.fields_used?.length ? ` fields=${source.fields_used.join(",")}` : ""
          }`
        }
      ]
    }));
  }

  const answerId = randomUUID();
  const answerContext = buildAnswerContext({
    answerId,
    intent: intent.intent,
    tone,
    retrievalStrategy,
    createdAt: new Date().toISOString(),
    matches: matchesWithCitations
  });
  answerContextStore.setLastAnswerContext(contextKey, answerContext);

  await auditLog(ctx, {
    action: "ANSWER_TONE",
    object_type: "answer",
    object_id: answerId,
    metadata: {
      tone
    }
  });

  return res.status(200).json({
    answer: answerPayload.answer,
    prompt: answerPayload.prompt,
    sources: matchesWithCitations,
    used_llm: answerPayload.used_llm
  });
};
