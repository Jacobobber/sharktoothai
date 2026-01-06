import { Router } from "express";
import type { RequestWithContext } from "../../../../../shared/types/api";
import { AppError } from "../../../../../shared/utils/errors";
import { withRequestContext, type DbClient } from "../../db/pg";
import { randomUUID } from "crypto";
import type { Role } from "../../../../../shared/types/domain";

export const adminApiRouter = Router();

const isDeveloperRole = (role?: Role) => role === "DEVELOPER";
const isDealerAdminRole = (role?: Role) => role === "DEALERADMIN";

const getTenantScope = async (
  ctx: RequestWithContext["context"],
  client: DbClient
): Promise<string[] | null> => {
  if (!ctx?.role) return [];
  if (isDeveloperRole(ctx.role)) return null;
  if (!ctx.tenantId) return [];
  if (isDealerAdminRole(ctx.role)) {
    const result = await client.query<{ group_id: string | null }>(
      `SELECT group_id FROM app.tenants WHERE tenant_id = $1`,
      [ctx.tenantId]
    );
    const groupId = result.rows[0]?.group_id ?? null;
    if (!groupId) return [ctx.tenantId];
    const tenants = await client.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM app.tenants WHERE group_id = $1`,
      [groupId]
    );
    return tenants.rows.map((row) => row.tenant_id);
  }
  return [ctx.tenantId];
};

adminApiRouter.get("/admin/api/tenants", async (req, res) => {
  const ctx = (req as RequestWithContext).context;
  if (!ctx?.requestId || !ctx?.userId || (!ctx?.tenantId && ctx?.role !== "DEVELOPER")) {
    const error = new AppError("Missing context", { status: 400, code: "CTX_MISSING" });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  try {
    const data = await withRequestContext(ctx, async (client) => {
      const scope = await getTenantScope(ctx, client);
      const params: any[] = [];
      const where = scope === null ? "" : "WHERE t.tenant_id = ANY($1)";
      if (scope !== null) params.push(scope);

      const result = await client.query<{
        tenant_id: string;
        name: string;
        is_active: boolean;
        pii_enabled: boolean;
        group_id: string | null;
        group_name: string | null;
        created_at: string;
      }>(
        `SELECT t.tenant_id,
                t.name,
                t.is_active,
                t.pii_enabled,
                t.group_id,
                g.name AS group_name,
                t.created_at
         FROM app.tenants t
         LEFT JOIN app.dealer_groups g ON g.group_id = t.group_id
         ${where}
         ORDER BY t.created_at DESC`,
        params
      );
      return result.rows;
    });
    return res.status(200).json({ data });
  } catch {
    const error = new AppError("Failed to fetch tenants", { status: 500, code: "ADMIN_TENANTS_FAIL" });
    return res.status(error.status ?? 500).json({ error: error.code, message: error.message });
  }
});

adminApiRouter.patch("/admin/api/tenants/:tenant_id", async (req, res) => {
  const ctx = (req as RequestWithContext).context;
  if (!ctx?.requestId || !ctx?.userId || (!ctx?.tenantId && ctx?.role !== "DEVELOPER")) {
    const error = new AppError("Missing context", { status: 400, code: "CTX_MISSING" });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  const tenantId = req.params.tenant_id;
  if (!tenantId) {
    const error = new AppError("Tenant mismatch", { status: 403, code: "TENANT_FORBIDDEN" });
    return res.status(error.status ?? 403).json({ error: error.code, message: error.message });
  }
  if (ctx.role !== "DEVELOPER" && tenantId !== ctx.tenantId) {
    const error = new AppError("Tenant mismatch", { status: 403, code: "TENANT_FORBIDDEN" });
    return res.status(error.status ?? 403).json({ error: error.code, message: error.message });
  }

  const { is_active, pii_enabled } = req.body ?? {};
  const updates: string[] = [];
  const params: any[] = [tenantId];
  if (typeof is_active === "boolean") {
    params.push(is_active);
    updates.push(`is_active = $${params.length}`);
  }
  if (typeof pii_enabled === "boolean") {
    params.push(pii_enabled);
    updates.push(`pii_enabled = $${params.length}`);
  }

  if (!updates.length) {
    const error = new AppError("No valid fields to update", { status: 400, code: "NO_UPDATES" });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  try {
    const data = await withRequestContext(ctx, async (client) => {
      const scope = await getTenantScope(ctx, client);
      if (scope !== null && !scope.includes(tenantId)) {
        throw new AppError("Tenant access denied", { status: 403, code: "TENANT_FORBIDDEN" });
      }
      const result = await client.query<{
        tenant_id: string;
        name: string;
        is_active: boolean;
        pii_enabled: boolean;
        group_id: string | null;
        group_name: string | null;
        created_at: string;
      }>(
        `UPDATE app.tenants
         SET ${updates.join(", ")}
         WHERE tenant_id = $1
         RETURNING tenant_id, name, is_active, pii_enabled, group_id, created_at`,
        params
      );
      const tenant = result.rows[0];
      if (!tenant?.group_id) return tenant;
      const group = await client.query<{ name: string }>(
        `SELECT name FROM app.dealer_groups WHERE group_id = $1`,
        [tenant.group_id]
      );
      return { ...tenant, group_name: group.rows[0]?.name ?? null };
      return result.rows[0];
    });
    return res.status(200).json({ data });
  } catch {
    const error = new AppError("Failed to update tenant", { status: 500, code: "ADMIN_TENANT_UPDATE_FAIL" });
    return res.status(error.status ?? 500).json({ error: error.code, message: error.message });
  }
});

adminApiRouter.post("/admin/api/tenants", async (req, res) => {
  const ctx = (req as RequestWithContext).context;
  if (!ctx?.requestId || !ctx?.userId || !ctx?.role || (!ctx?.tenantId && ctx.role !== "DEVELOPER")) {
    const error = new AppError("Missing context", { status: 400, code: "CTX_MISSING" });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  if (!isDeveloperRole(ctx.role)) {
    const error = new AppError("Insufficient role", { status: 403, code: "ROLE_FORBIDDEN" });
    return res.status(error.status ?? 403).json({ error: error.code, message: error.message });
  }

  const name = (req.body?.name as string | undefined)?.trim();
  const groupId = (req.body?.group_id as string | undefined)?.trim() || null;
  if (!name) {
    const error = new AppError("name required", { status: 400, code: "BAD_REQUEST" });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  try {
    const data = await withRequestContext(ctx, async (client) => {
      if (groupId) {
        const exists = await client.query<{ group_id: string }>(
          `SELECT group_id FROM app.dealer_groups WHERE group_id = $1`,
          [groupId]
        );
        if (!exists.rows[0]) {
          throw new AppError("Group not found", { status: 404, code: "GROUP_NOT_FOUND" });
        }
      }
      const existing = await client.query<{ tenant_id: string }>(
        `SELECT tenant_id FROM app.tenants WHERE LOWER(name) = LOWER($1)`,
        [name]
      );
      if (existing.rows[0]?.tenant_id) {
        throw new AppError("Tenant name already exists", { status: 409, code: "TENANT_EXISTS" });
      }
      const tenantId = randomUUID();
      const result = await client.query<{
        tenant_id: string;
        name: string;
        is_active: boolean;
        pii_enabled: boolean;
        group_id: string | null;
        created_at: string;
      }>(
        `INSERT INTO app.tenants (tenant_id, name, is_active, group_id)
         VALUES ($1, $2, true, $3)
         RETURNING tenant_id, name, is_active, pii_enabled, group_id, created_at`,
        [tenantId, name, groupId]
      );
      return result.rows[0];
    });
    return res.status(201).json({ data });
  } catch {
    const error = new AppError("Failed to create tenant", { status: 500, code: "ADMIN_TENANT_CREATE_FAIL" });
    return res.status(error.status ?? 500).json({ error: error.code, message: error.message });
  }
});

adminApiRouter.get("/admin/api/pii/summary", async (req, res) => {
  const ctx = (req as RequestWithContext).context;
  if (!ctx?.requestId || !ctx?.userId || (!ctx?.tenantId && ctx?.role !== "DEVELOPER")) {
    const error = new AppError("Missing context", { status: 400, code: "CTX_MISSING" });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  try {
    const data = await withRequestContext(ctx, async (client) => {
      const scope = await getTenantScope(ctx, client);
      const params: any[] = [];
      const where = scope === null ? "" : "WHERE tenant_id = ANY($1)";
      if (scope !== null) params.push(scope);
      const result = await client.query<{
        tenant_id: string;
        pii_count: number;
        last_updated: string | null;
      }>(
        `SELECT tenant_id,
                COUNT(*)::int AS pii_count,
                MAX(updated_at) AS last_updated
         FROM app.pii_vault
         ${where}
         GROUP BY tenant_id`,
        params
      );
      return result.rows;
    });
    return res.status(200).json({ data });
  } catch {
    const error = new AppError("Failed to fetch PII summary", { status: 500, code: "ADMIN_PII_SUMMARY_FAIL" });
    return res.status(error.status ?? 500).json({ error: error.code, message: error.message });
  }
});

adminApiRouter.get("/admin/api/chats", async (req, res) => {
  const ctx = (req as RequestWithContext).context;
  if (!ctx?.requestId || !ctx?.userId || (!ctx?.tenantId && ctx?.role !== "DEVELOPER")) {
    const error = new AppError("Missing context", { status: 400, code: "CTX_MISSING" });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  const limit = Math.min(Number(req.query.limit) || 50, 200);

  try {
    const data = await withRequestContext(ctx, async (client) => {
      const scope = await getTenantScope(ctx, client);
      const params: any[] = [];
      let where = "";
      if (scope !== null) {
        params.push(scope);
        where = "WHERE c.tenant_id = ANY($1)";
      }
      params.push(limit);
      const limitParam = params.length;
      const result = await client.query<{
        conversation_id: string;
        title: string;
        created_at: string;
        last_message_at: string;
        tenant_id: string;
        tenant_name: string;
        user_id: string;
        user_email: string;
      }>(
        `SELECT c.conversation_id,
                c.title,
                c.created_at,
                c.last_message_at,
                c.tenant_id,
                t.name AS tenant_name,
                c.user_id,
                u.email AS user_email
         FROM chat.conversations c
         JOIN app.users u ON u.user_id = c.user_id
         JOIN app.tenants t ON t.tenant_id = c.tenant_id
         ${where}
         ORDER BY c.last_message_at DESC
         LIMIT $${limitParam}`,
        params
      );
      return result.rows;
    });
    return res.status(200).json({ data });
  } catch {
    const error = new AppError("Failed to fetch chats", { status: 500, code: "ADMIN_CHATS_FAIL" });
    return res.status(error.status ?? 500).json({ error: error.code, message: error.message });
  }
});

adminApiRouter.get("/admin/api/chats/:conversation_id/messages", async (req, res) => {
  const ctx = (req as RequestWithContext).context;
  if (!ctx?.requestId || !ctx?.userId || (!ctx?.tenantId && ctx?.role !== "DEVELOPER")) {
    const error = new AppError("Missing context", { status: 400, code: "CTX_MISSING" });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  const conversationId = req.params.conversation_id;
  if (!conversationId) {
    const error = new AppError("conversation_id required", { status: 400, code: "BAD_REQUEST" });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  try {
    const data = await withRequestContext(ctx, async (client) => {
      const scope = await getTenantScope(ctx, client);
      const params: any[] = [conversationId];
      let where = "WHERE c.conversation_id = $1";
      if (scope !== null) {
        params.push(scope);
        where += ` AND c.tenant_id = ANY($2)`;
      }
      const convo = await client.query<{ conversation_id: string }>(
        `SELECT c.conversation_id
         FROM chat.conversations c
         ${where}`,
        params
      );
      if (!convo.rows[0]) {
        throw new AppError("Conversation not found", { status: 404, code: "CHAT_NOT_FOUND" });
      }

      const messages = await client.query<{
        message_id: string;
        role: string;
        content: string;
        created_at: string;
      }>(
        `SELECT message_id, role, content, created_at
         FROM chat.messages
         WHERE conversation_id = $1
         ORDER BY created_at ASC`,
        [conversationId]
      );
      return messages.rows;
    });
    return res.status(200).json({ data });
  } catch (err) {
    const status = err instanceof AppError && err.status ? err.status : 500;
    const code = err instanceof AppError && err.code ? err.code : "ADMIN_CHAT_MESSAGES_FAIL";
    const message = err instanceof AppError ? err.message : "Failed to fetch chat messages";
    return res.status(status).json({ error: code, message });
  }
});
