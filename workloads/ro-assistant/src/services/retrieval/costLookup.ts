import type { RequestContext } from "../../../../../shared/types/api";
import type { DbClient } from "../../../../../platform/gateway/src/db/pg";
import { resolveTenantScope } from "./tenantScope";

export type CostLookupMatch = {
  ro_id: string;
  ro_number: string;
  labor_total: number;
  parts_total: number;
  total: number;
};

export const resolveCostLookup = async (
  client: DbClient,
  ctx: RequestContext,
  options: {
    roNumbers?: string[];
    limit?: number;
  }
): Promise<CostLookupMatch[]> => {
  const scope = await resolveTenantScope(client, ctx);
  const limit = options.limit ?? 3;
  const roNumbers = options.roNumbers?.length ? options.roNumbers : null;

  const result = await client.query<{
    ro_id: string;
    ro_number: string;
    labor_total: string | null;
    parts_total: string | null;
  }>(
    `SELECT d.ro_id,
            d.ro_number,
            d.labor_total::text AS labor_total,
            d.parts_total::text AS parts_total
     FROM app.ro_deterministic_v2 d
     WHERE d.tenant_id = ANY($1::uuid[])
       AND ($2::text[] IS NULL OR d.ro_number = ANY($2::text[]))
     ORDER BY (COALESCE(d.labor_total, 0) + COALESCE(d.parts_total, 0)) DESC
     LIMIT $3`,
    [scope.tenantIds, roNumbers, limit]
  );

  return result.rows
    .map((row) => {
      const labor = Number(row.labor_total ?? 0);
      const parts = Number(row.parts_total ?? 0);
      return {
        ro_id: row.ro_id,
        ro_number: row.ro_number,
        labor_total: labor,
        parts_total: parts,
        total: labor + parts
      };
    })
    .filter((row) => row.total > 0);
};
