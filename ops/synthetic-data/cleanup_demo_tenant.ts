import dotenv from "dotenv";
import { Pool, type PoolClient } from "pg";

dotenv.config();

type Args = {
  tenantId: string;
  dryRun: boolean;
  requireConfirm: boolean;
  confirm?: string;
};

type TableSpec = {
  name: string;
  optional?: boolean;
};

const REQUIRED_CONFIRMATION = "DELETE_DEMO_TENANT_DATA";
const SAFE_NAME_PATTERN = /(demo|synthetic|test)/i;
const BLOCKED_TENANT_IDS = new Set<string>([
  "00000000-0000-0000-0000-000000000000"
]);

const parseBool = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback;
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;
  return fallback;
};

const getArgValue = (argv: string[], key: string) => {
  const direct = argv.find((arg) => arg.startsWith(`${key}=`));
  if (direct) return direct.split("=").slice(1).join("=");
  const index = argv.findIndex((arg) => arg === key);
  if (index >= 0) return argv[index + 1];
  return undefined;
};

const parseArgs = (argv: string[]): Args => {
  const tenantId = getArgValue(argv, "--tenant-id") ?? "";
  const dryRun = parseBool(getArgValue(argv, "--dry-run"), true);
  const requireConfirm = parseBool(getArgValue(argv, "--require-confirm"), true);
  const confirm = getArgValue(argv, "--confirm");
  return { tenantId, dryRun, requireConfirm, confirm };
};

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

const TABLES: TableSpec[] = [
  { name: "app.embeddings" },
  { name: "app.chunks" },
  { name: "app.ro_parts_lines" },
  { name: "app.ro_labor_lines" },
  { name: "app.ro_deterministic_v2" },
  { name: "app.repair_orders" },
  { name: "app.pii_vault" },
  { name: "chat.messages", optional: true },
  { name: "chat.conversations", optional: true }
];

const tableExists = async (client: PoolClient, name: string) => {
  const result = await client.query<{ exists: string | null }>(
    "SELECT to_regclass($1) AS exists",
    [name]
  );
  return Boolean(result.rows[0]?.exists);
};

const countRows = async (
  client: PoolClient,
  table: string,
  tenantId: string
) => {
  const result = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${table} WHERE tenant_id = $1`,
    [tenantId]
  );
  return Number.parseInt(result.rows[0]?.count ?? "0", 10);
};

const deleteRows = async (
  client: PoolClient,
  table: string,
  tenantId: string
) => {
  const result = await client.query<{ count: string }>(
    `WITH deleted AS (
      DELETE FROM ${table} WHERE tenant_id = $1 RETURNING 1
    ) SELECT count(*)::text AS count FROM deleted`,
    [tenantId]
  );
  return Number.parseInt(result.rows[0]?.count ?? "0", 10);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.tenantId || !isUuid(args.tenantId)) {
    throw new Error("tenant_id is required and must be a valid UUID");
  }
  if (BLOCKED_TENANT_IDS.has(args.tenantId)) {
    throw new Error("Refusing to run: tenant_id matches blocked production list");
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL not configured");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const tenantResult = await client.query<{ tenant_id: string; name: string }>(
      "SELECT tenant_id, name FROM app.tenants WHERE tenant_id = $1",
      [args.tenantId]
    );
    const tenant = tenantResult.rows[0];
    if (!tenant) {
      throw new Error("tenant_id not found");
    }
    if (!SAFE_NAME_PATTERN.test(tenant.name)) {
      throw new Error("Refusing to run: tenant name does not indicate demo or synthetic usage");
    }

    console.log(`Tenant: ${tenant.name} (${tenant.tenant_id})`);
    console.log(`Dry run: ${args.dryRun}`);
    console.log(`Require confirm: ${args.requireConfirm}`);

    if (!args.dryRun && args.requireConfirm) {
      if (args.confirm !== REQUIRED_CONFIRMATION) {
        throw new Error(`Confirmation required: --confirm=${REQUIRED_CONFIRMATION}`);
      }
    }

    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [args.tenantId]);
    await client.query("SELECT set_config('app.role', 'ADMIN', true)");

    const counts: Record<string, number> = {};
    for (const table of TABLES) {
      const exists = table.optional ? await tableExists(client, table.name) : true;
      if (!exists) {
        console.log(`Skipping missing table: ${table.name}`);
        continue;
      }
      const count = await countRows(client, table.name, args.tenantId);
      counts[table.name] = count;
      console.log(`Count ${table.name}: ${count}`);
    }

    if (args.dryRun) {
      console.log("Dry run mode enabled. No data will be deleted.");
      for (const table of TABLES) {
        const exists = table.optional ? await tableExists(client, table.name) : true;
        if (!exists) continue;
        console.log(`DELETE FROM ${table.name} WHERE tenant_id = $1;`);
      }
      await client.query("ROLLBACK");
      return;
    }

    const deletedCounts: Record<string, number> = {};
    for (const table of TABLES) {
      const exists = table.optional ? await tableExists(client, table.name) : true;
      if (!exists) continue;
      deletedCounts[table.name] = await deleteRows(client, table.name, args.tenantId);
    }

    await client.query("COMMIT");

    const timestampUtc = new Date().toISOString();
    console.log("Cleanup completed.");
    console.log(`tenant_id: ${args.tenantId}`);
    console.log(`timestamp_utc: ${timestampUtc}`);
    for (const [table, count] of Object.entries(deletedCounts)) {
      console.log(`deleted ${table}: ${count}`);
    }

    const verifyClient = await pool.connect();
    try {
      await verifyClient.query("BEGIN");
      await verifyClient.query("SELECT set_config('app.tenant_id', $1, true)", [args.tenantId]);
      await verifyClient.query("SELECT set_config('app.role', 'ADMIN', true)");
      const verifyTables = ["app.repair_orders", "app.chunks", "app.embeddings", "app.pii_vault"];
      for (const table of verifyTables) {
        const count = await countRows(verifyClient, table, args.tenantId);
        if (count !== 0) {
          throw new Error(`Post-clean verification failed for ${table}: ${count} rows remain`);
        }
      }
      await verifyClient.query("COMMIT");
    } catch (err) {
      await verifyClient.query("ROLLBACK");
      throw err;
    } finally {
      verifyClient.release();
    }
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("Rollback failed", rollbackErr);
    }
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
