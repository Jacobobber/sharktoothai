import type { RequestContext } from "../../../../../shared/types/api";
import type { DbClient } from "../../../../../platform/gateway/src/db/pg";

export type ChunkRecord = {
  chunk_id: string;
  chunk_text: string;
  chunk_index: number;
  ro_id: string;
};

export const getChunksByIds = async (
  client: DbClient,
  ctx: RequestContext,
  chunkIds: string[],
  tenantIds?: string[]
): Promise<ChunkRecord[]> => {
  if (!chunkIds.length) return [];
  const scopedTenantIds = tenantIds !== undefined ? tenantIds : [ctx.tenantId];
  if (!scopedTenantIds.length) return [];
  const { rows } = await client.query<ChunkRecord>(
    `SELECT chunk_id, chunk_text, chunk_index
            , ro_id
      FROM app.chunks
     WHERE tenant_id = ANY($1::uuid[]) AND chunk_id = ANY($2::uuid[])`,
    [scopedTenantIds, chunkIds]
  );
  return rows;
};
