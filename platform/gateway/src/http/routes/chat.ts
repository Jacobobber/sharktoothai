import { Router } from "express";
import { randomUUID } from "crypto";
import type { RequestWithContext } from "../../../../../shared/types/api";
import { AppError } from "../../../../../shared/utils/errors";
import { runWithTransaction, withRequestContext } from "../../db/pg";
import { embedQuery } from "../../../../../workloads/ro-assistant/src/services/ingest/embed";
import { resolveTenantScope } from "../../../../../workloads/ro-assistant/src/services/retrieval/tenantScope";
import { vectorSearch } from "../../../../../workloads/ro-assistant/src/services/retrieval/vectorSearch";
import { getChunksByIds } from "../../../../../workloads/ro-assistant/src/services/ro/chunkRepo";
import { getRosByIds } from "../../../../../workloads/ro-assistant/src/services/ro/roRepo";
import { buildCitedAnswer } from "../../../../../workloads/ro-assistant/src/services/retrieval/cite";

export const chatRouter = Router();

const requireContext = (req: RequestWithContext) => {
  const ctx = req.context;
  if (!ctx?.tenantId || !ctx?.userId || !ctx?.requestId || !ctx?.role) {
    throw new AppError("Missing request context", { status: 400, code: "CTX_MISSING" });
  }
  return ctx;
};

chatRouter.get("/chat/conversations", async (req, res) => {
  try {
    const ctx = requireContext(req as RequestWithContext);
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const data = await withRequestContext(ctx, async (client) => {
      const result = await client.query(
        `SELECT conversation_id, title, created_at, last_message_at
         FROM chat.conversations
         WHERE tenant_id = $1 AND user_id = $2
         ORDER BY last_message_at DESC
         LIMIT $3`,
        [ctx.tenantId, ctx.userId, limit]
      );
      return result.rows;
    });
    return res.status(200).json({ data });
  } catch (err) {
    const error = err instanceof AppError ? err : new AppError("Failed to list conversations");
    return res.status(error.status ?? 500).json({ error: error.code, message: error.message });
  }
});

chatRouter.post("/chat/conversations", async (req, res) => {
  try {
    const ctx = requireContext(req as RequestWithContext);
    const title = (req.body?.title as string | undefined)?.trim() || "New chat";
    const conversationId = randomUUID();
    const data = await withRequestContext(ctx, async (client) => {
      const result = await client.query(
        `INSERT INTO chat.conversations
         (conversation_id, tenant_id, user_id, title)
         VALUES ($1, $2, $3, $4)
         RETURNING conversation_id, title, created_at, last_message_at`,
        [conversationId, ctx.tenantId, ctx.userId, title]
      );
      return result.rows[0];
    });
    return res.status(201).json({ data });
  } catch (err) {
    const error = err instanceof AppError ? err : new AppError("Failed to create conversation");
    return res.status(error.status ?? 500).json({ error: error.code, message: error.message });
  }
});

chatRouter.get("/chat/conversations/:id/messages", async (req, res) => {
  try {
    const ctx = requireContext(req as RequestWithContext);
    const conversationId = req.params.id;
    const data = await withRequestContext(ctx, async (client) => {
      const convo = await client.query(
        `SELECT conversation_id
         FROM chat.conversations
         WHERE conversation_id = $1 AND tenant_id = $2 AND user_id = $3`,
        [conversationId, ctx.tenantId, ctx.userId]
      );
      if (!convo.rows[0]) {
        throw new AppError("Conversation not found", { status: 404, code: "CHAT_NOT_FOUND" });
      }
      const result = await client.query(
        `SELECT message_id, role, content, created_at
         FROM chat.messages
         WHERE conversation_id = $1
         ORDER BY created_at ASC`,
        [conversationId]
      );
      return result.rows;
    });
    return res.status(200).json({ data });
  } catch (err) {
    const error = err instanceof AppError ? err : new AppError("Failed to load messages");
    return res.status(error.status ?? 500).json({ error: error.code, message: error.message });
  }
});

chatRouter.post("/chat/messages", async (req, res) => {
  try {
    const ctx = requireContext(req as RequestWithContext);
    const message = (req.body?.message as string | undefined)?.trim();
    if (!message) {
      throw new AppError("message is required", { status: 400, code: "BAD_REQUEST" });
    }
    const topK = req.body?.top_k && req.body.top_k > 0 ? Math.min(req.body.top_k, 5) : 3;
    const queryEmbedding = await embedQuery(message);
    const scopeTenantId = req.header("x-scope-tenant-id");
    const scopeGroupId = req.header("x-scope-group-id");

    let conversationId = req.body?.conversation_id as string | undefined;

    await runWithTransaction(ctx, async (client) => {
      if (conversationId) {
        const convo = await client.query(
          `SELECT conversation_id
           FROM chat.conversations
           WHERE conversation_id = $1 AND tenant_id = $2 AND user_id = $3`,
          [conversationId, ctx.tenantId, ctx.userId]
        );
        if (!convo.rows[0]) {
          throw new AppError("Conversation not found", { status: 404, code: "CHAT_NOT_FOUND" });
        }
      } else {
        conversationId = randomUUID();
        await client.query(
          `INSERT INTO chat.conversations
           (conversation_id, tenant_id, user_id, title)
           VALUES ($1, $2, $3, 'New chat')`,
          [conversationId, ctx.tenantId, ctx.userId]
        );
      }

      await client.query(
        `INSERT INTO chat.messages
         (message_id, conversation_id, tenant_id, user_id, role, content)
         VALUES ($1, $2, $3, $4, 'USER', $5)`,
        [randomUUID(), conversationId, ctx.tenantId, ctx.userId, message]
      );
    });

    if (!conversationId) {
      throw new AppError("Conversation not found", { status: 404, code: "CHAT_NOT_FOUND" });
    }

    const fetchMatches = async (embedding: number[]) =>
      withRequestContext(ctx, async (client) => {
        const scope = await resolveTenantScope(client, ctx, {
          scopeTenantId,
          scopeGroupId
        });
        const matches = await vectorSearch(client, ctx, embedding, topK, scope.tenantIds);
        const chunkIds = matches.map((m) => m.chunk_id);
        const chunks = await getChunksByIds(client, ctx, chunkIds, scope.tenantIds);
        const roIds = Array.from(new Set(chunks.map((c) => c.ro_id)));
        const ros = await getRosByIds(client, ctx, roIds, scope.tenantIds);

        const chunkMap = new Map(chunks.map((c) => [c.chunk_id, c]));
        const roMap = new Map(ros.map((r) => [r.ro_id, r]));

        return matches.map((m) => {
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
      });

    let matchesWithCitations = await fetchMatches(queryEmbedding);
    if (!matchesWithCitations.length && conversationId) {
      const lastAssistant = await withRequestContext(ctx, async (client) => {
        const result = await client.query<{ content: string }>(
          `SELECT content
           FROM chat.messages
           WHERE conversation_id = $1
             AND role = 'ASSISTANT'
           ORDER BY created_at DESC
           LIMIT 1`,
          [conversationId]
        );
        return result.rows[0]?.content ?? null;
      });
      if (lastAssistant) {
        const followupEmbedding = await embedQuery(
          `${message}\nPrevious assistant summary: ${lastAssistant}`
        );
        matchesWithCitations = await fetchMatches(followupEmbedding);
      }
    }

    const { answer, used_llm } = await buildCitedAnswer({
      question: message,
      matches: matchesWithCitations
    });

    await runWithTransaction(ctx, async (client) => {
      await client.query(
        `INSERT INTO chat.messages
         (message_id, conversation_id, tenant_id, user_id, role, content)
         VALUES ($1, $2, $3, $4, 'ASSISTANT', $5)`,
        [randomUUID(), conversationId, ctx.tenantId, ctx.userId, answer]
      );

      const title = message.split(/\s+/).slice(0, 6).join(" ");
      await client.query(
        `UPDATE chat.conversations
         SET last_message_at = now(),
             title = CASE WHEN title = 'New chat' THEN $2 ELSE title END
         WHERE conversation_id = $1`,
        [conversationId, title]
      );
    });

    return res.status(200).json({
      conversation_id: conversationId,
      answer,
      sources: matchesWithCitations,
      used_llm
    });
  } catch (err) {
    const error = err instanceof AppError ? err : new AppError("Chat response failed");
    return res.status(error.status ?? 500).json({ error: error.code, message: error.message });
  }
});
