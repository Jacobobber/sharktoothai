import type { RequestContext } from "../../../../../shared/types/api";
import type { DbClient } from "../../../../../platform/gateway/src/db/pg";

export type RoRecord = {
  ro_id: string;
  ro_number: string;
};

export const getRosByIds = async (
  client: DbClient,
  ctx: RequestContext,
  roIds: string[],
  tenantIds?: string[]
): Promise<RoRecord[]> => {
  if (!roIds.length) return [];
  const scopedTenantIds = tenantIds !== undefined ? tenantIds : [ctx.tenantId];
  if (!scopedTenantIds.length) return [];
  const { rows } = await client.query<RoRecord>(
    `SELECT ro_id, ro_number
       FROM app.repair_orders
      WHERE tenant_id = ANY($1::uuid[])
        AND ro_id = ANY($2::uuid[])`,
    [scopedTenantIds, roIds]
  );
  return rows;
};
