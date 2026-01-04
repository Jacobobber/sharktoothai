import type { RequestHandler } from "express";
import type { RequestWithContext } from "../../../../shared/types/api";
import { AppError } from "../../../../shared/utils/errors";
import { sha256 } from "../../../../shared/utils/hash";
import { auditLog } from "../../../../platform/gateway/src/core/audit/auditService";
import { withRequestContext } from "../../../../platform/gateway/src/db/pg";
import { embedQuery } from "../services/ingest/embed";
import { resolveTenantScope } from "../services/retrieval/tenantScope";
import { vectorSearch } from "../services/retrieval/vectorSearch";
import { getChunksByIds } from "../services/ro/chunkRepo";
import { getRosByIds } from "../services/ro/roRepo";
import { buildCitedAnswer } from "../services/retrieval/cite";

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
  if (ctx.role !== "USER" && ctx.role !== "ADMIN" && ctx.role !== "DEALERADMIN" && ctx.role !== "DEVELOPER") {
    const error = new AppError("Insufficient role", { status: 403, code: "ROLE_FORBIDDEN" });
    return res.status(error.status ?? 403).json({ error: error.code, message: error.message });
  }

  const body = req.body as AnswerBody;
  if (!body?.question || typeof body.question !== "string") {
    const error = new AppError("question is required", { status: 400, code: "BAD_REQUEST" });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }
  const topK = body.top_k && body.top_k > 0 ? Math.min(body.top_k, 5) : 3;

  const queryEmbedding = await embedQuery(body.question);
  const scopeTenantId = req.header("x-scope-tenant-id");
  const scopeGroupId = req.header("x-scope-group-id");

  try {
    const { matches, chunks, ros } = await withRequestContext(ctx, async (client) => {
      const scope = await resolveTenantScope(client, ctx, {
        scopeTenantId,
        scopeGroupId
      });
      const matches = await vectorSearch(client, ctx, queryEmbedding, topK, scope.tenantIds);
      const chunkIds = matches.map((m) => m.chunk_id);
      const chunks = await getChunksByIds(client, ctx, chunkIds, scope.tenantIds);
      const roIds = Array.from(new Set(chunks.map((c) => c.ro_id)));
      const ros = await getRosByIds(client, ctx, roIds, scope.tenantIds);
      return { matches, chunks, ros };
    });

    await auditLog(ctx, {
      action: "ANSWER",
      object_type: "repair_order",
      metadata: { question_hash: sha256(body.question) }
    });

    const chunkMap = new Map(chunks.map((c) => [c.chunk_id, c]));
    const roMap = new Map(ros.map((r) => [r.ro_id, r]));

    const matchesWithCitations = matches.map((m) => {
      const chunk = chunkMap.get(m.chunk_id);
      const ro = chunk ? roMap.get(chunk.ro_id) : undefined;
      return {
        ro_number: ro?.ro_number ?? null,
        score: m.score,
        citations: chunk
          ? [
              {
                chunk_id: chunk.chunk_id,
                excerpt: chunk.chunk_text.slice(0, 400)
              }
            ]
        : []
      };
    });

    const { prompt, answer, used_llm } = await buildCitedAnswer({
      question: body.question,
      matches: matchesWithCitations
    });

    return res.status(200).json({
      answer,
      prompt,
      sources: matchesWithCitations,
      used_llm
    });
  } catch (err) {
    const error = new AppError("Answer generation failed", { status: 500, code: "ANSWER_FAILED" });
    return res.status(error.status ?? 500).json({ error: error.code, message: error.message });
  }
};
