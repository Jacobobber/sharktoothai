import type { RequestContext } from "../../../../../shared/types/api";
import { AppError } from "../../../../../shared/utils/errors";
import type { DbClient } from "../../../../../platform/gateway/src/db/pg";

type ScopeInput = {
  scopeTenantId?: string | null;
  scopeGroupId?: string | null;
};

type TenantScope = {
  tenantIds: string[];
  scope: "tenant" | "group";
};

const fetchGroupTenants = async (client: DbClient, groupId: string) => {
  const tenants = await client.query<{ tenant_id: string }>(
    `SELECT tenant_id FROM app.tenants WHERE group_id = $1`,
    [groupId]
  );
  return tenants.rows.map((row) => row.tenant_id);
};

const fetchGroupExists = async (client: DbClient, groupId: string) => {
  const result = await client.query<{ group_id: string }>(
    `SELECT group_id FROM app.dealer_groups WHERE group_id = $1`,
    [groupId]
  );
  return Boolean(result.rows[0]?.group_id);
};

const fetchTenantExists = async (client: DbClient, tenantId: string) => {
  const result = await client.query<{ tenant_id: string }>(
    `SELECT tenant_id FROM app.tenants WHERE tenant_id = $1`,
    [tenantId]
  );
  return Boolean(result.rows[0]?.tenant_id);
};

export const resolveTenantScope = async (
  client: DbClient,
  ctx: RequestContext,
  input: ScopeInput = {}
): Promise<TenantScope> => {
  if (!ctx?.tenantId || !ctx?.role) {
    throw new AppError("Missing request context", { status: 400, code: "CTX_MISSING" });
  }

  const scopeTenantId = input.scopeTenantId?.trim();
  const scopeGroupId = input.scopeGroupId?.trim();

  if (ctx.role === "DEVELOPER") {
    if (scopeTenantId && scopeGroupId) {
      throw new AppError("Only one scope allowed", { status: 400, code: "SCOPE_INVALID" });
    }
    if (scopeGroupId) {
      const exists = await fetchGroupExists(client, scopeGroupId);
      if (!exists) {
        throw new AppError("Group not found", { status: 404, code: "GROUP_NOT_FOUND" });
      }
      const tenantIds = await fetchGroupTenants(client, scopeGroupId);
      return { tenantIds, scope: "group" };
    }
    if (scopeTenantId) {
      const exists = await fetchTenantExists(client, scopeTenantId);
      if (!exists) {
        throw new AppError("Tenant not found", { status: 404, code: "TENANT_NOT_FOUND" });
      }
      return { tenantIds: [scopeTenantId], scope: "tenant" };
    }
    return { tenantIds: [ctx.tenantId], scope: "tenant" };
  }

  if (ctx.role === "DEALERADMIN") {
    const result = await client.query<{ group_id: string | null }>(
      `SELECT group_id FROM app.tenants WHERE tenant_id = $1`,
      [ctx.tenantId]
    );
    const groupId = result.rows[0]?.group_id ?? null;
    if (!groupId) {
      return { tenantIds: [ctx.tenantId], scope: "tenant" };
    }
    const tenantIds = await fetchGroupTenants(client, groupId);
    if (!tenantIds.length) {
      return { tenantIds: [ctx.tenantId], scope: "tenant" };
    }
    return { tenantIds, scope: "group" };
  }

  return { tenantIds: [ctx.tenantId], scope: "tenant" };
};
