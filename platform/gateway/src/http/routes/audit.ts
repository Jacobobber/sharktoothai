import { Router } from "express";
import type { RequestWithContext } from "../../../../../shared/types/api";
import { auditLog } from "../../core/audit/auditService";
import { withRequestContext } from "../../db/pg";
import { AppError } from "../../../../../shared/utils/errors";

export const auditRouter = Router();

auditRouter.get("/audit", async (req, res) => {
  const ctx = (req as RequestWithContext).context;
  if (!ctx?.requestId || !ctx?.userId || (!ctx?.tenantId && ctx?.role !== "DEVELOPER")) {
    const error = new AppError("Missing context", { status: 400, code: "CTX_MISSING" });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const cursor = (req.query.cursor as string | undefined) ?? undefined;
  const action = (req.query.action as string | undefined) ?? undefined;
  const userIdFilter = (req.query.user_id as string | undefined) ?? undefined;
  const start = (req.query.start as string | undefined) ?? undefined;
  const end = (req.query.end as string | undefined) ?? undefined;

  try {
    const data = await withRequestContext(ctx, async (client) => {
      let groupId: string | null = null;
      if (ctx.tenantId) {
        const scopeResult = await client.query<{ group_id: string | null }>(
          `SELECT group_id FROM app.tenants WHERE tenant_id = $1`,
          [ctx.tenantId]
        );
        groupId = scopeResult.rows[0]?.group_id ?? null;
      }
      const isDeveloper = ctx.role === "DEVELOPER";
      const isDealerAdmin = ctx.role === "DEALERADMIN";
      const params: any[] = [];
      const where: string[] = [];

      if (!isDeveloper) {
        if (isDealerAdmin && groupId) {
          params.push(groupId);
          where.push(`tenant_id IN (SELECT tenant_id FROM app.tenants WHERE group_id = $1)`);
        } else {
          params.push(ctx.tenantId);
          where.push(`tenant_id = $1`);
        }
      }

      if (action) {
        params.push(action);
        where.push(`action = $${params.length}`);
      }
      if (userIdFilter) {
        params.push(userIdFilter);
        where.push(`user_id = $${params.length}`);
      }
      if (start) {
        params.push(start);
        where.push(`created_at >= $${params.length}`);
      }
      if (end) {
        params.push(end);
        where.push(`created_at <= $${params.length}`);
      }
      if (cursor) {
        const [cursorTime, cursorId] = cursor.split("|");
        params.push(cursorTime);
        params.push(cursorId);
        where.push(`(created_at, audit_id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
      }

      params.push(limit + 1);
      const sql = `
        SELECT audit_id, action, object_type, object_id, metadata, created_at, request_id, user_id
        FROM app.audit_logs
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY created_at DESC, audit_id DESC
        LIMIT $${params.length}
      `;
      const result = await client.query(sql, params);
      const rows = result.rows.slice(0, limit);
      const nextCursor =
        result.rows.length > limit
          ? `${result.rows[limit].created_at.toISOString()}|${result.rows[limit].audit_id}`
          : undefined;
      return { rows, nextCursor };
    });

    await auditLog(ctx, { action: "AUDIT_LIST", object_type: "audit" });

    return res.status(200).json({ data: data.rows, next_cursor: data.nextCursor });
  } catch (err) {
    const error = new AppError("Failed to fetch audit logs", { status: 500, code: "AUDIT_READ_FAILED" });
    return res.status(error.status ?? 500).json({ error: error.code, message: error.message });
  }
});
