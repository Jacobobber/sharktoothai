import { Router } from "express";
import type { RequestWithContext } from "../../../../../shared/types/api";
import { AppError } from "../../../../../shared/utils/errors";
import { withRequestContext, type DbClient } from "../../db/pg";
import { randomUUID } from "crypto";
import type { Role } from "../../../../../shared/types/domain";

export const adminUsersRouter = Router();

type NewUserBody = {
  email: string;
  password: string;
  role: Role;
  tenant_id?: string;
  tenant_name?: string;
};

type UpdateUserBody = {
  role?: Role;
  is_active?: boolean;
};

const isAdminRole = (role?: Role) => role === "ADMIN";
const isDealerAdminRole = (role?: Role) => role === "DEALERADMIN";
const isDeveloperRole = (role?: Role) => role === "DEVELOPER";
const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

const allowedRolesForCreator = (creatorRole: Role): Role[] => {
  if (creatorRole === "DEVELOPER") return ["USER", "ADMIN", "DEALERADMIN", "DEVELOPER"];
  if (creatorRole === "DEALERADMIN") return ["USER", "ADMIN"];
  if (creatorRole === "ADMIN") return ["USER"];
  return [];
};

const canManageTenant = async (
  ctx: RequestWithContext["context"],
  client: DbClient,
  targetTenantId: string
): Promise<boolean> => {
  if (!ctx?.tenantId || !ctx?.role) return false;
  if (isDeveloperRole(ctx.role)) return true;
  if (ctx.role === "ADMIN") return targetTenantId === ctx.tenantId;
  if (ctx.role === "DEALERADMIN") {
    const result = await client.query<{ group_id: string | null }>(
      `SELECT group_id FROM app.tenants WHERE tenant_id = $1`,
      [targetTenantId]
    );
    const targetGroup = result.rows[0]?.group_id ?? null;
    const source = await client.query<{ group_id: string | null }>(
      `SELECT group_id FROM app.tenants WHERE tenant_id = $1`,
      [ctx.tenantId]
    );
    const sourceGroup = source.rows[0]?.group_id ?? null;
    return Boolean(targetGroup && sourceGroup && targetGroup === sourceGroup);
  }
  return false;
};

adminUsersRouter.get("/admin/api/users", async (req, res) => {
  const ctx = (req as RequestWithContext).context;
  if (!ctx?.tenantId || !ctx?.requestId || !ctx?.userId || !ctx?.role) {
    const error = new AppError("Missing context", { status: 400, code: "CTX_MISSING" });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  const tenantId = req.query.tenant_id as string | undefined;

  try {
    const data = await withRequestContext(ctx, async (client) => {
      if (isDeveloperRole(ctx.role as Role) && !tenantId) {
        const result = await client.query<{
          user_id: string;
          tenant_id: string;
          email: string;
          role: Role;
          is_active: boolean;
          created_at: string;
        }>(
          `SELECT user_id, tenant_id, email, role, is_active, created_at
           FROM app.users
           ORDER BY created_at DESC`
        );
        return result.rows;
      }

      if (isDealerAdminRole(ctx.role as Role) && !tenantId) {
        const group = await client.query<{ group_id: string | null }>(
          `SELECT group_id FROM app.tenants WHERE tenant_id = $1`,
          [ctx.tenantId]
        );
        const groupId = group.rows[0]?.group_id ?? null;
        if (!groupId) {
          throw new AppError("Dealer group not set", { status: 400, code: "GROUP_REQUIRED" });
        }
        const result = await client.query<{
          user_id: string;
          tenant_id: string;
          email: string;
          role: Role;
          is_active: boolean;
          created_at: string;
        }>(
          `SELECT user_id, tenant_id, email, role, is_active, created_at
           FROM app.users
           WHERE tenant_id IN (SELECT tenant_id FROM app.tenants WHERE group_id = $1)
           ORDER BY created_at DESC`,
          [groupId]
        );
        return result.rows;
      }

      const targetTenant = tenantId ?? ctx.tenantId;
      if (!targetTenant) {
        throw new AppError("Tenant context missing", { status: 403, code: "TENANT_REQUIRED" });
      }
      const allowed = await canManageTenant(ctx, client, targetTenant);
      if (!allowed) {
        throw new AppError("Tenant access denied", { status: 403, code: "TENANT_FORBIDDEN" });
      }
      const result = await client.query<{
        user_id: string;
        tenant_id: string;
        email: string;
        role: Role;
        is_active: boolean;
        created_at: string;
      }>(
        `SELECT user_id, tenant_id, email, role, is_active, created_at
         FROM app.users
         WHERE tenant_id = $1
         ORDER BY created_at DESC`,
        [targetTenant]
      );
      return result.rows;
    });
    return res.status(200).json({ data });
  } catch (err) {
    const status = err instanceof AppError && err.status ? err.status : 500;
    const code = err instanceof AppError && err.code ? err.code : "ADMIN_USERS_FAIL";
    const message = err instanceof AppError ? err.message : "Failed to fetch users";
    return res.status(status).json({ error: code, message });
  }
});

adminUsersRouter.post("/admin/api/users", async (req, res) => {
  const ctx = (req as RequestWithContext).context;
  if (!ctx?.tenantId || !ctx?.requestId || !ctx?.userId || !ctx?.role) {
    const error = new AppError("Missing context", { status: 400, code: "CTX_MISSING" });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  const body = req.body as NewUserBody;
  if (!body?.email || !body?.password || !body?.role || (!body?.tenant_id && !body?.tenant_name)) {
    const error = new AppError("email, password, role, tenant_id or tenant_name required", {
      status: 400,
      code: "BAD_REQUEST"
    });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  const allowedRoles = allowedRolesForCreator(ctx.role as Role);
  if (!allowedRoles.includes(body.role)) {
    const error = new AppError("Role not allowed", { status: 403, code: "ROLE_FORBIDDEN" });
    return res.status(error.status ?? 403).json({ error: error.code, message: error.message });
  }

  try {
    const data = await withRequestContext(ctx, async (client) => {
      let resolvedTenantId = body.tenant_id ?? null;
      if (!resolvedTenantId && body.tenant_name) {
        const lookup = await client.query<{ tenant_id: string }>(
          `SELECT tenant_id FROM app.tenants WHERE LOWER(name) = LOWER($1)`,
          [body.tenant_name.trim()]
        );
        resolvedTenantId = lookup.rows[0]?.tenant_id ?? null;
      }
      if (!resolvedTenantId) {
        throw new AppError("Tenant not found", { status: 404, code: "TENANT_NOT_FOUND" });
      }
      const allowed = await canManageTenant(ctx, client, resolvedTenantId);
      if (!allowed) {
        throw new AppError("Tenant access denied", { status: 403, code: "TENANT_FORBIDDEN" });
      }
      const bcrypt = await import("bcryptjs");
      const passHash = await bcrypt.hash(body.password, 10);
      const result = await client.query<{
        user_id: string;
        tenant_id: string;
        email: string;
        role: Role;
        is_active: boolean;
        created_at: string;
      }>(
        `INSERT INTO app.users (user_id, tenant_id, email, pass_hash, role, is_active)
         VALUES ($1, $2, $3, $4, $5, true)
         RETURNING user_id, tenant_id, email, role, is_active, created_at`,
        [randomUUID(), resolvedTenantId, body.email.toLowerCase(), passHash, body.role]
      );
      return result.rows[0];
    });
    return res.status(201).json({ data });
  } catch (err) {
    const status = err instanceof AppError && err.status ? err.status : 500;
    const code = err instanceof AppError && err.code ? err.code : "ADMIN_USER_CREATE_FAIL";
    const message = err instanceof AppError ? err.message : "Failed to create user";
    return res.status(status).json({ error: code, message });
  }
});

adminUsersRouter.patch("/admin/api/users/:user_id", async (req, res) => {
  const ctx = (req as RequestWithContext).context;
  if (!ctx?.tenantId || !ctx?.requestId || !ctx?.userId || !ctx?.role) {
    const error = new AppError("Missing context", { status: 400, code: "CTX_MISSING" });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  const body = req.body as UpdateUserBody;
  const updates: string[] = [];
  const params: any[] = [req.params.user_id];

  if (typeof body.is_active === "boolean") {
    params.push(body.is_active);
    updates.push(`is_active = $${params.length}`);
  }
  if (body.role) {
    const allowedRoles = allowedRolesForCreator(ctx.role as Role);
    if (!allowedRoles.includes(body.role)) {
      const error = new AppError("Role not allowed", { status: 403, code: "ROLE_FORBIDDEN" });
      return res.status(error.status ?? 403).json({ error: error.code, message: error.message });
    }
    params.push(body.role);
    updates.push(`role = $${params.length}`);
  }

  if (!updates.length) {
    const error = new AppError("No valid fields to update", { status: 400, code: "NO_UPDATES" });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  try {
    const data = await withRequestContext(ctx, async (client) => {
      const lookup = await client.query<{ tenant_id: string }>(
        `SELECT tenant_id FROM app.users WHERE user_id = $1`,
        [req.params.user_id]
      );
      const targetTenant = lookup.rows[0]?.tenant_id;
      if (!targetTenant) {
        throw new AppError("User not found", { status: 404, code: "USER_NOT_FOUND" });
      }
      const allowed = await canManageTenant(ctx, client, targetTenant);
      if (!allowed) {
        throw new AppError("Tenant access denied", { status: 403, code: "TENANT_FORBIDDEN" });
      }
      const result = await client.query<{
        user_id: string;
        tenant_id: string;
        email: string;
        role: Role;
        is_active: boolean;
        created_at: string;
      }>(
        `UPDATE app.users
         SET ${updates.join(", ")}
         WHERE user_id = $1
         RETURNING user_id, tenant_id, email, role, is_active, created_at`,
        params
      );
      return result.rows[0];
    });
    return res.status(200).json({ data });
  } catch (err) {
    const status = err instanceof AppError && err.status ? err.status : 500;
    const code = err instanceof AppError && err.code ? err.code : "ADMIN_USER_UPDATE_FAIL";
    const message = err instanceof AppError ? err.message : "Failed to update user";
    return res.status(status).json({ error: code, message });
  }
});

adminUsersRouter.delete("/admin/api/users/:user_id", async (req, res) => {
  const ctx = (req as RequestWithContext).context;
  if (!ctx?.tenantId || !ctx?.requestId || !ctx?.userId || !ctx?.role) {
    const error = new AppError("Missing context", { status: 400, code: "CTX_MISSING" });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  try {
    const data = await withRequestContext(ctx, async (client) => {
      const lookup = await client.query<{ tenant_id: string }>(
        `SELECT tenant_id FROM app.users WHERE user_id = $1`,
        [req.params.user_id]
      );
      const targetTenant = lookup.rows[0]?.tenant_id;
      if (!targetTenant) {
        throw new AppError("User not found", { status: 404, code: "USER_NOT_FOUND" });
      }
      const allowed = await canManageTenant(ctx, client, targetTenant);
      if (!allowed) {
        throw new AppError("Tenant access denied", { status: 403, code: "TENANT_FORBIDDEN" });
      }
      const result = await client.query<{ user_id: string; email: string }>(
        `DELETE FROM app.users WHERE user_id = $1 RETURNING user_id, email`,
        [req.params.user_id]
      );
      return result.rows[0];
    });
    return res.status(200).json({ data });
  } catch (err) {
    const status = err instanceof AppError && err.status ? err.status : 500;
    const code = err instanceof AppError && err.code ? err.code : "ADMIN_USER_DELETE_FAIL";
    const message = err instanceof AppError ? err.message : "Failed to delete user";
    return res.status(status).json({ error: code, message });
  }
});

adminUsersRouter.get("/admin/api/groups", async (req, res) => {
  const ctx = (req as RequestWithContext).context;
  if (!ctx?.tenantId || !ctx?.requestId || !ctx?.userId || !ctx?.role) {
    const error = new AppError("Missing context", { status: 400, code: "CTX_MISSING" });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  try {
    const data = await withRequestContext(ctx, async (client) => {
      if (!isDeveloperRole(ctx.role as Role)) {
        throw new AppError("Insufficient role", { status: 403, code: "ROLE_FORBIDDEN" });
      }
      const result = await client.query<{
        group_id: string;
        name: string;
        created_at: string;
      }>(
        `SELECT group_id, name, created_at
         FROM app.dealer_groups
         ORDER BY created_at DESC`
      );
      return result.rows;
    });
    return res.status(200).json({ data });
  } catch (err) {
    const status = err instanceof AppError && err.status ? err.status : 500;
    const code = err instanceof AppError && err.code ? err.code : "ADMIN_GROUPS_FAIL";
    const message = err instanceof AppError ? err.message : "Failed to fetch groups";
    return res.status(status).json({ error: code, message });
  }
});

adminUsersRouter.post("/admin/api/groups", async (req, res) => {
  const ctx = (req as RequestWithContext).context;
  if (!ctx?.tenantId || !ctx?.requestId || !ctx?.userId || !ctx?.role) {
    const error = new AppError("Missing context", { status: 400, code: "CTX_MISSING" });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  const name = (req.body?.name as string | undefined)?.trim();
  if (!name) {
    const error = new AppError("name required", { status: 400, code: "BAD_REQUEST" });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  if (!isDeveloperRole(ctx.role as Role)) {
    const error = new AppError("Insufficient role", { status: 403, code: "ROLE_FORBIDDEN" });
    return res.status(error.status ?? 403).json({ error: error.code, message: error.message });
  }

  try {
    const data = await withRequestContext(ctx, async (client) => {
      const result = await client.query<{
        group_id: string;
        name: string;
        created_at: string;
      }>(
        `INSERT INTO app.dealer_groups (group_id, name)
         VALUES (gen_random_uuid(), $1)
         RETURNING group_id, name, created_at`,
        [name]
      );
      return result.rows[0];
    });
    return res.status(201).json({ data });
  } catch (err) {
    const status = err instanceof AppError && err.status ? err.status : 500;
    const code = err instanceof AppError && err.code ? err.code : "ADMIN_GROUP_CREATE_FAIL";
    const message = err instanceof AppError ? err.message : "Failed to create group";
    return res.status(status).json({ error: code, message });
  }
});

adminUsersRouter.patch("/admin/api/tenants/:tenant_id/group", async (req, res) => {
  const ctx = (req as RequestWithContext).context;
  if (!ctx?.tenantId || !ctx?.requestId || !ctx?.userId || !ctx?.role) {
    const error = new AppError("Missing context", { status: 400, code: "CTX_MISSING" });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  const groupId = req.body?.group_id as string | null | undefined;
  if (groupId === undefined) {
    const error = new AppError("group_id required", { status: 400, code: "BAD_REQUEST" });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  if (!isDeveloperRole(ctx.role as Role)) {
    const error = new AppError("Insufficient role", { status: 403, code: "ROLE_FORBIDDEN" });
    return res.status(error.status ?? 403).json({ error: error.code, message: error.message });
  }

  try {
    const data = await withRequestContext(ctx, async (client) => {
      let resolvedGroupId: string | null = groupId;
      if (groupId && !isUuid(groupId)) {
        const trimmed = groupId.trim();
        const existing = await client.query<{ group_id: string }>(
          `SELECT group_id FROM app.dealer_groups WHERE LOWER(name) = LOWER($1)`,
          [trimmed]
        );
        if (existing.rows[0]?.group_id) {
          resolvedGroupId = existing.rows[0].group_id;
        } else {
          const created = await client.query<{ group_id: string }>(
            `INSERT INTO app.dealer_groups (group_id, name)
             VALUES ($1, $2)
             RETURNING group_id`,
            [randomUUID(), trimmed]
          );
          resolvedGroupId = created.rows[0].group_id;
        }
      }
      const result = await client.query<{
        tenant_id: string;
        group_id: string | null;
      }>(
        `UPDATE app.tenants
         SET group_id = $2
         WHERE tenant_id = $1
         RETURNING tenant_id, group_id`,
        [req.params.tenant_id, resolvedGroupId]
      );
      return result.rows[0];
    });
    return res.status(200).json({ data });
  } catch (err) {
    const status = err instanceof AppError && err.status ? err.status : 500;
    const code = err instanceof AppError && err.code ? err.code : "ADMIN_GROUP_ASSIGN_FAIL";
    const message = err instanceof AppError ? err.message : "Failed to assign tenant group";
    return res.status(status).json({ error: code, message });
  }
});
