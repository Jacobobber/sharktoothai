import type { RequestContext } from "../../../../../shared/types/api";
import { AppError } from "../../../../../shared/utils/errors";
import type { DbClient } from "../../../../../platform/gateway/src/db/pg";

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

export const resolveTenantScope = async (
  client: DbClient,
  ctx: RequestContext
): Promise<TenantScope> => {
  if (!ctx?.tenantId || !ctx?.role) {
    throw new AppError("Missing request context", { status: 400, code: "CTX_MISSING" });
  }
  // Headers are intentionally ignored; tenant scope is DB-enforced via RLS.

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
