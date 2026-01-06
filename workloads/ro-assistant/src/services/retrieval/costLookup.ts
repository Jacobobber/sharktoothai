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
    scopeTenantId?: string | null;
    scopeGroupId?: string | null;
    roNumbers?: string[];
    limit?: number;
  }
): Promise<CostLookupMatch[]> => {
  const scope = await resolveTenantScope(client, ctx, {
    scopeTenantId: options.scopeTenantId,
    scopeGroupId: options.scopeGroupId
  });
  const limit = options.limit ?? 3;
  const roNumbers = options.roNumbers?.length ? options.roNumbers : null;

  const result = await client.query<{
    ro_id: string;
    ro_number: string;
    labor_total: string | null;
    parts_total: string | null;
  }>(
    `SELECT r.ro_id,
            r.ro_number,
            COALESCE(SUM(l.amount), 0)::text AS labor_total,
            COALESCE(SUM(p.line_total), 0)::text AS parts_total
     FROM app.repair_orders r
     LEFT JOIN app.ro_labor_lines l
       ON l.ro_id = r.ro_id AND l.tenant_id = r.tenant_id
     LEFT JOIN app.ro_parts_lines p
       ON p.ro_id = r.ro_id AND p.tenant_id = r.tenant_id
     WHERE r.tenant_id = ANY($1::uuid[])
       AND ($2::text[] IS NULL OR r.ro_number = ANY($2::text[]))
     GROUP BY r.ro_id, r.ro_number
     ORDER BY (COALESCE(SUM(l.amount), 0) + COALESCE(SUM(p.line_total), 0)) DESC
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
