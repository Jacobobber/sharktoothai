import type { RequestContext } from "../../../../../shared/types/api";
import type { DbClient } from "../../../../../platform/gateway/src/db/pg";
import { resolveTenantScope } from "./tenantScope";
import { resolveStrictLookup } from "./strictLookup";
import { resolveCostLookup, type CostLookupMatch } from "./costLookup";
import { parseRoNumbers } from "./roNumberLookup";

export type DeterministicLookupRow = {
  ro_id: string;
  ro_number: string;
  ro_status: string | null;
  open_timestamp: string | null;
  close_timestamp: string | null;
  labor_total: number | null;
  parts_total: number | null;
  grand_total: number | null;
};

export type DeterministicAggregate = {
  label: string;
  value: number;
};

export const fetchDeterministicLookup = async (
  client: DbClient,
  ctx: RequestContext,
  query: string
): Promise<DeterministicLookupRow[]> => {
  const strict = await resolveStrictLookup(client, ctx, query);
  if (!strict.roNumbers.length) return [];
  const scope = await resolveTenantScope(client, ctx);
  const { rows } = await client.query<DeterministicLookupRow>(
    `SELECT ro_id,
            ro_number,
            ro_status,
            open_timestamp,
            close_timestamp,
            labor_total,
            parts_total,
            grand_total
     FROM app.ro_deterministic_v2
     WHERE tenant_id = ANY($1::uuid[])
       AND ro_number = ANY($2::text[])`,
    [scope.tenantIds, strict.roNumbers]
  );
  return rows;
};

export const fetchDeterministicCost = async (
  client: DbClient,
  ctx: RequestContext,
  query: string,
  limit?: number
): Promise<CostLookupMatch[]> => {
  const roNumbers = parseRoNumbers(query);
  return resolveCostLookup(client, ctx, { roNumbers, limit });
};

export const fetchDeterministicCount = async (
  client: DbClient,
  ctx: RequestContext,
  query: string
): Promise<DeterministicAggregate | null> => {
  const scope = await resolveTenantScope(client, ctx);
  const roNumbers = parseRoNumbers(query);
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM app.repair_orders
     WHERE tenant_id = ANY($1::uuid[])
       AND ($2::text[] IS NULL OR ro_number = ANY($2::text[]))`,
    [scope.tenantIds, roNumbers.length ? roNumbers : null]
  );
  const value = Number(result.rows[0]?.count ?? 0);
  return { label: "repair_orders", value };
};
