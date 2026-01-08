import type { RequestContext } from "../../../../../shared/types/api";
import type { DbClient } from "../../../../../platform/gateway/src/db/pg";
import { resolveTenantScope } from "./tenantScope";

export const parseRoNumbers = (input: string): string[] => {
  const matches = input.match(/RO[-\s]?\d{3,6}/gi) ?? [];
  const normalized = matches.map((match) => {
    const cleaned = match.replace(/\s+/g, "-").toUpperCase();
    return cleaned.includes("RO-") ? cleaned : cleaned.replace("RO", "RO-");
  });
  return Array.from(new Set(normalized));
};

export const fetchRoChunksByNumber = async (
  client: DbClient,
  ctx: RequestContext,
  input: string
): Promise<
  Array<{
    ro_number: string | null;
    score: number;
    citations: Array<{ excerpt: string }>;
  }>
> => {
  const roNumbers = parseRoNumbers(input);
  if (!roNumbers.length) return [];

  const scope = await resolveTenantScope(client, ctx);

  const ros = await client.query<{ ro_id: string; ro_number: string }>(
    `SELECT ro_id, ro_number
     FROM app.repair_orders
     WHERE tenant_id = ANY($1::uuid[])
       AND ro_number = ANY($2::text[])`,
    [scope.tenantIds, roNumbers]
  );
  if (!ros.rows.length) return [];

  const roIds = ros.rows.map((row) => row.ro_id);
  const roMap = new Map(ros.rows.map((row) => [row.ro_id, row.ro_number]));

  const chunks = await client.query<{ chunk_text: string; ro_id: string }>(
    `SELECT chunk_text, ro_id
     FROM app.chunks
     WHERE tenant_id = ANY($1::uuid[])
       AND ro_id = ANY($2::uuid[])
     ORDER BY ro_id, chunk_index`,
    [scope.tenantIds, roIds]
  );

  return chunks.rows.map((chunk) => ({
    ro_number: roMap.get(chunk.ro_id) ?? null,
    score: 1,
    citations: [
      {
        excerpt: chunk.chunk_text.slice(0, 400)
      }
    ]
  }));
};
