import dotenv from "dotenv";
import { Pool, type PoolClient } from "pg";

dotenv.config();

type Args = {
  confirm?: string;
  force: boolean;
  dryRun: boolean;
  understood: boolean;
  includeAuditLogs: boolean;
};

type TableSpec = {
  name: string;
  optional?: boolean;
  gated?: "audit";
};

const REQUIRED_CONFIRMATION = "RESET_ALL_TENANTS_AND_USERS";
const REQUIRED_UNDERSTAND_FLAG = "--i-understand-this-will-delete-everything";
const BLOCKED_HOST_PATTERNS = [/\bprod\b/i, /production/i];
const DEFAULT_BLOCKED_HOSTS = new Set<string>();

const parseBool = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback;
  const normalized = value.toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return fallback;
};

const getArgValue = (argv: string[], key: string) => {
  const direct = argv.find((arg) => arg.startsWith(`${key}=`));
  if (direct) return direct.split("=").slice(1).join("=");
  const index = argv.findIndex((arg) => arg === key);
  if (index >= 0) return argv[index + 1];
  return undefined;
};

const hasFlag = (argv: string[], flag: string) => argv.includes(flag);

const parseArgs = (argv: string[]): Args => {
  const dryRun = parseBool(getArgValue(argv, "--dry-run"), true);
  const force = hasFlag(argv, "--force") || parseBool(getArgValue(argv, "--force"), false);
  const confirm = getArgValue(argv, "--confirm");
  const understood = hasFlag(argv, REQUIRED_UNDERSTAND_FLAG);
  const includeAuditLogs = hasFlag(argv, "--include-audit-logs");
  return {
    confirm,
    force,
    dryRun,
    understood,
    includeAuditLogs
  };
};

const parseDatabaseUrl = (databaseUrl: string) => {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch (err) {
    throw new Error("DATABASE_URL is not a valid URL");
  }
  const hostname = url.hostname;
  const database = url.pathname.replace(/^\//, "");
  if (!hostname) {
    throw new Error("DATABASE_URL hostname is missing");
  }
  if (!database) {
    throw new Error("DATABASE_URL database name is missing");
  }
  return { hostname, database };
};

const assertNonProduction = (hostname: string) => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run: NODE_ENV is production");
  }
  const blockedHosts = new Set(
    [...DEFAULT_BLOCKED_HOSTS, ...(process.env.RESET_BLOCKED_DB_HOSTS ?? "").split(",")]
      .map((host) => host.trim())
      .filter(Boolean)
  );
  if (blockedHosts.has(hostname)) {
    throw new Error(`Refusing to run: DATABASE_URL host ${hostname} is blocked`);
  }
  if (BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(hostname))) {
    throw new Error(
      `Refusing to run: DATABASE_URL host ${hostname} matches production hostname pattern`
    );
  }
};

const TABLES: TableSpec[] = [
  { name: "app.embeddings" },
  { name: "app.chunks" },
  { name: "app.ro_parts_lines" },
  { name: "app.ro_labor_lines" },
  { name: "app.ro_deterministic_v2" },
  { name: "app.repair_orders" },
  { name: "app.documents" },
  { name: "app.pii_vault" },
  { name: "app.audit_logs", optional: true, gated: "audit" },
  { name: "chat.messages", optional: true },
  { name: "chat.conversations", optional: true },
  { name: "app.user_group_memberships", optional: true },
  { name: "app.users" },
  { name: "app.tenants" },
  { name: "app.groups", optional: true },
  { name: "app.dealer_groups", optional: true }
];

const tableExists = async (client: PoolClient, name: string) => {
  const result = await client.query<{ exists: string | null }>(
    "SELECT to_regclass($1) AS exists",
    [name]
  );
  return Boolean(result.rows[0]?.exists);
};

const countRows = async (client: PoolClient, table: string) => {
  const result = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${table}`
  );
  return Number.parseInt(result.rows[0]?.count ?? "0", 10);
};

const deleteRows = async (client: PoolClient, table: string) => {
  const result = await client.query<{ count: string }>(
    `WITH deleted AS (
      DELETE FROM ${table} RETURNING 1
    ) SELECT count(*)::text AS count FROM deleted`
  );
  return Number.parseInt(result.rows[0]?.count ?? "0", 10);
};

const setRlsContext = async (client: PoolClient) => {
  await client.query("SELECT set_config('app.request_id', $1, true)", ["reset-all-data"]);
  await client.query("SELECT set_config('app.user_id', $1, true)", [""]);
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [""]);
  await client.query("SELECT set_config('app.role', $1, true)", ["DEVELOPER"]);
};

const ensureTableAvailable = async (client: PoolClient, table: TableSpec) => {
  const exists = await tableExists(client, table.name);
  if (!exists && table.optional) {
    console.log(`Skipping missing table: ${table.name}`);
    return false;
  }
  if (!exists) {
    throw new Error(`Required table missing: ${table.name}`);
  }
  return true;
};

const shouldIncludeTable = (table: TableSpec, args: Args) => {
  if (table.gated === "audit" && !args.includeAuditLogs) {
    console.log("Skipping app.audit_logs (use --include-audit-logs to include)");
    return false;
  }
  return true;
};

const verifyGroupsTable = async (client: PoolClient) => {
  const dealerGroupsExists = await tableExists(client, "app.dealer_groups");
  const groupsExists = await tableExists(client, "app.groups");
  if (!dealerGroupsExists && !groupsExists) {
    throw new Error("Required groups table missing: app.dealer_groups or app.groups");
  }
  if (dealerGroupsExists) {
    const count = await countRows(client, "app.dealer_groups");
    if (count !== 0) {
      throw new Error(`Post-reset verification failed for app.dealer_groups: ${count} rows remain`);
    }
  }
  if (groupsExists) {
    const count = await countRows(client, "app.groups");
    if (count !== 0) {
      throw new Error(`Post-reset verification failed for app.groups: ${count} rows remain`);
    }
  }
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));

  if (!args.understood) {
    throw new Error(`Missing required flag: ${REQUIRED_UNDERSTAND_FLAG}`);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL not configured");
  }

  const { hostname, database } = parseDatabaseUrl(databaseUrl);
  assertNonProduction(hostname);

  const timestamp = new Date().toISOString();
  console.log(`Environment: ${process.env.NODE_ENV ?? "(not set)"}`);
  console.log(`Database host: ${hostname}`);
  console.log(`Database name: ${database}`);
  console.log(`Timestamp: ${timestamp}`);
  console.log(`Dry run: ${args.dryRun}`);

  if (!args.dryRun) {
    if (!args.force) {
      throw new Error("Refusing to run: --force is required when dry-run is false");
    }
    if (args.confirm !== REQUIRED_CONFIRMATION) {
      throw new Error(`Confirmation required: --confirm=${REQUIRED_CONFIRMATION}`);
    }
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  const startedAt = process.hrtime.bigint();
  try {
    await client.query("BEGIN");
    await setRlsContext(client);
    try {
      await client.query("SET LOCAL row_security = off");
    } catch (err) {
      throw new Error("Unable to disable RLS; required for full reset");
    }

    const counts: Record<string, number> = {};
    for (const table of TABLES) {
      if (!shouldIncludeTable(table, args)) {
        continue;
      }
      const available = await ensureTableAvailable(client, table);
      if (!available) continue;
      const count = await countRows(client, table.name);
      counts[table.name] = count;
      console.log(`Count ${table.name}: ${count}`);
    }

    if (args.dryRun) {
      console.log("Dry run mode enabled. No data will be deleted.");
      for (const table of TABLES) {
        if (!shouldIncludeTable(table, args)) continue;
        const available = await ensureTableAvailable(client, table);
        if (!available) continue;
        console.log(`DELETE FROM ${table.name};`);
      }
      await client.query("ROLLBACK");
      return;
    }

    const deletedCounts: Record<string, number> = {};
    for (const table of TABLES) {
      if (!shouldIncludeTable(table, args)) continue;
      const available = await ensureTableAvailable(client, table);
      if (!available) continue;
      deletedCounts[table.name] = await deleteRows(client, table.name);
    }

    await client.query("COMMIT");

    const elapsedSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
    console.log("Reset completed.");
    for (const [table, count] of Object.entries(deletedCounts)) {
      console.log(`Deleted ${table}: ${count}`);
    }
    console.log(`Elapsed seconds: ${elapsedSeconds.toFixed(2)}`);
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

  const verifyPool = new Pool({ connectionString: databaseUrl });
  const verifyClient = await verifyPool.connect();
  try {
    await verifyClient.query("BEGIN");
    await setRlsContext(verifyClient);
    try {
      await verifyClient.query("SET LOCAL row_security = off");
    } catch (err) {
      throw new Error("Unable to disable RLS during verification");
    }

    const verificationTables = [
      "app.tenants",
      "app.users",
      "app.repair_orders",
      "app.ro_deterministic_v2",
      "app.chunks",
      "app.embeddings",
      "app.pii_vault"
    ];

    for (const table of verificationTables) {
      const exists = await tableExists(verifyClient, table);
      if (!exists) {
        throw new Error(`Required table missing during verification: ${table}`);
      }
      const count = await countRows(verifyClient, table);
      if (count !== 0) {
        throw new Error(`Post-reset verification failed for ${table}: ${count} rows remain`);
      }
    }

    await verifyGroupsTable(verifyClient);
    await verifyClient.query("COMMIT");
  } catch (err) {
    try {
      await verifyClient.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("Verification rollback failed", rollbackErr);
    }
    throw err;
  } finally {
    verifyClient.release();
    await verifyPool.end();
  }

  console.log("SYSTEM RESET COMPLETE — READY FOR TENANT RECREATION");
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
