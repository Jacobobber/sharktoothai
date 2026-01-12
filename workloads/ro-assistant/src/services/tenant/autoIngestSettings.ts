import type { DbClient } from "../../../../../platform/gateway/src/db/pg";

// Settings resolution only; no side effects or ingestion triggers here.
export const resolveAutoIngestEnabled = async (
  client: DbClient,
  groupId: string,
  tenantId: string
): Promise<boolean> => {
  const tenantResult = await client.query<{
    auto_ingest_enabled: boolean | null;
    group_id: string;
  }>(
    `SELECT auto_ingest_enabled, group_id
     FROM app.tenant_settings
     WHERE tenant_id = $1`,
    [tenantId]
  );

  if (tenantResult.rows[0]) {
    const tenantSetting = tenantResult.rows[0].auto_ingest_enabled;
    if (tenantSetting !== null && tenantSetting !== undefined) {
      return Boolean(tenantSetting);
    }
    const resolvedGroupId = tenantResult.rows[0].group_id;
    const groupResult = await client.query<{ auto_ingest_enabled: boolean | null }>(
      `SELECT auto_ingest_enabled
       FROM app.group_settings
       WHERE group_id = $1`,
      [resolvedGroupId]
    );
    return Boolean(groupResult.rows[0]?.auto_ingest_enabled);
  }

  const groupResult = await client.query<{ auto_ingest_enabled: boolean | null }>(
    `SELECT auto_ingest_enabled
     FROM app.group_settings
     WHERE group_id = $1`,
    [groupId]
  );
  return Boolean(groupResult.rows[0]?.auto_ingest_enabled);
};
