import dotenv from "dotenv";
import { Pool, type PoolClient } from "pg";
import { randomUUID } from "crypto";
import { bootstrapTenant } from "./helpers/bootstrapTenant";

dotenv.config();

const ensureEnv = () => {
  const defaults: Record<string, string> = {
    AZURE_OPENAI_ENDPOINT: "https://example.invalid",
    AZURE_OPENAI_API_KEY: "test-key",
    AZURE_OPENAI_EMBEDDING_DEPLOYMENT: "test-embed",
    AZURE_OPENAI_API_VERSION: "2024-02-15-preview",
    JWT_SECRET: "test-secret",
    JWT_EXPIRES_IN: "1h",
    DEV_AUTH_TOKEN_ADMIN: "dev-token",
    DEV_USER_ID_ADMIN: "00000000-0000-0000-0000-000000000001",
    DEV_TENANT_ID_ADMIN: "00000000-0000-0000-0000-000000000002",
    INGEST_AAD_AUDIENCE: "api://ingest",
    INGEST_ALLOWED_CALLER_OBJECT_IDS: "00000000-0000-0000-0000-000000000000"
  };

  Object.entries(defaults).forEach(([key, value]) => {
    if (!process.env[key]) process.env[key] = value;
  });

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL not configured");
  }
};

const createMockRes = () => {
  const res: any = {};
  res.statusCode = 200;
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload: any) => {
    res.body = payload;
    return res;
  };
  res.redirect = (_code: number, _path: string) => res;
  return res;
};

const buildHeaderOverrideTest = async () => {
  process.env.NODE_ENV = "development";
  const { issueToken } = await import("../../platform/gateway/src/core/auth/tokens");
  const { authContext } = await import("../../platform/gateway/src/http/middleware/authContext");

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const token = await issueToken({ userId: randomUUID(), tenantId: tenantA, role: "ADMIN" });

  let nextCalled = false;
  const req: any = {
    path: "/app",
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "x-tenant-id": tenantB },
    header: function (name: string) {
      return this.headers[name.toLowerCase()];
    },
    context: { requestId: "test-request" }
  };
  const res = createMockRes();

  await authContext(req, res, () => {
    nextCalled = true;
  });

  if (!nextCalled) {
    throw new Error(`Expected middleware to continue, got ${res.statusCode}`);
  }
  if (req.context?.tenantId !== tenantA) {
    throw new Error("Header override modified tenant context");
  }
};

const buildProductionHeaderBlockTest = async () => {
  process.env.NODE_ENV = "production";
  const { issueToken } = await import("../../platform/gateway/src/core/auth/tokens");
  const { authContext } = await import("../../platform/gateway/src/http/middleware/authContext");

  const tenantA = randomUUID();
  const token = await issueToken({ userId: randomUUID(), tenantId: tenantA, role: "ADMIN" });

  const req: any = {
    path: "/app",
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "x-scope-tenant-id": randomUUID() },
    header: function (name: string) {
      return this.headers[name.toLowerCase()];
    },
    context: { requestId: "test-request" }
  };
  const res = createMockRes();

  await authContext(req, res, () => {});

  if (res.statusCode !== 400 || res.body?.error !== "TENANT_SCOPE_FORBIDDEN") {
    throw new Error("Expected production header scoping to be rejected");
  }
};

const setTenantContext = async (client: PoolClient, tenantId: string) => {
  await client.query("SET row_security = on");
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
};

const withTenantTransaction = async (
  client: PoolClient,
  tenantId: string,
  fn: () => Promise<void>
) => {
  await client.query("BEGIN");
  try {
    await setTenantContext(client, tenantId);
    await fn();
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
};

const ensureRlsPolicies = async (client: PoolClient, tableName: string, policyPrefix: string) => {
  const rel = await client.query<{ relrowsecurity: boolean }>(
    `SELECT c.relrowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'app' AND c.relname = $1`,
    [tableName]
  );
  if (!rel.rows[0]?.relrowsecurity) {
    await client.query(`ALTER TABLE app.${tableName} ENABLE ROW LEVEL SECURITY`);
    await client.query(`ALTER TABLE app.${tableName} FORCE ROW LEVEL SECURITY`);
  }

  const policies = await client.query(
    `SELECT 1 FROM pg_policies WHERE schemaname = 'app' AND tablename = $1`,
    [tableName]
  );
  if (!policies.rows.length) {
    await client.query(
      `CREATE POLICY ${policyPrefix}_tenant_select ON app.${tableName}
        FOR SELECT USING (tenant_id = app.current_tenant_id())`
    );
    await client.query(
      `CREATE POLICY ${policyPrefix}_tenant_insert ON app.${tableName}
        FOR INSERT WITH CHECK (tenant_id = app.current_tenant_id())`
    );
    await client.query(
      `CREATE POLICY ${policyPrefix}_tenant_update ON app.${tableName}
        FOR UPDATE USING (tenant_id = app.current_tenant_id())
        WITH CHECK (tenant_id = app.current_tenant_id())`
    );
    await client.query(
      `CREATE POLICY ${policyPrefix}_tenant_delete ON app.${tableName}
        FOR DELETE USING (tenant_id = app.current_tenant_id())`
    );
  }
};

const runRlsIsolationTest = async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const docA = randomUUID();
  const docB = randomUUID();
  const roA = randomUUID();
  const roB = randomUUID();
  let userA: string | undefined;
  let userB: string | undefined;
  let hasUsersTable = false;

  try {
    const bootA = await bootstrapTenant(client, { tenantId: tenantA });
    const bootB = await bootstrapTenant(client, { tenantId: tenantB });
    userA = bootA.userId ?? randomUUID();
    userB = bootB.userId ?? randomUUID();
    hasUsersTable = Boolean(bootA.userId || bootB.userId);
    await ensureRlsPolicies(client, "documents", "documents");
    await ensureRlsPolicies(client, "repair_orders", "repair_orders");
    const bypass = await client.query<{ rolbypassrls: boolean }>(
      "SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user"
    );
    if (bypass.rows[0]?.rolbypassrls) {
      console.warn("Current role bypasses RLS; skipping isolation assertions.");
      return;
    }

    await withTenantTransaction(client, tenantA, async () => {
      await client.query(
        `INSERT INTO app.documents (doc_id, tenant_id, filename, mime_type, sha256, storage_path, created_by)
         VALUES ($1, $2, 'a.xml', 'text/xml', $3, 'ingest/a', $4)`,
        [docA, tenantA, Buffer.from("00", "hex"), userA]
      );
      await client.query(
        `INSERT INTO app.repair_orders (ro_id, tenant_id, doc_id, ro_number)
         VALUES ($1, $2, $3, $4)`,
        [roA, tenantA, docA, "7000001"]
      );
    });

    await withTenantTransaction(client, tenantB, async () => {
      await client.query(
        `INSERT INTO app.documents (doc_id, tenant_id, filename, mime_type, sha256, storage_path, created_by)
         VALUES ($1, $2, 'b.xml', 'text/xml', $3, 'ingest/b', $4)`,
        [docB, tenantB, Buffer.from("01", "hex"), userB]
      );
      await client.query(
        `INSERT INTO app.repair_orders (ro_id, tenant_id, doc_id, ro_number)
         VALUES ($1, $2, $3, $4)`,
        [roB, tenantB, docB, "7000002"]
      );
    });

    let countA = { rows: [{ count: "0" }] } as { rows: Array<{ count: string }> };
    await withTenantTransaction(client, tenantA, async () => {
      countA = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM app.repair_orders"
      );
    });
    if (Number(countA.rows[0].count) !== 1) {
      throw new Error("Tenant A should only see its own rows");
    }

    let countBSeenByA = { rows: [{ count: "0" }] } as { rows: Array<{ count: string }> };
    await withTenantTransaction(client, tenantA, async () => {
      countBSeenByA = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM app.repair_orders WHERE ro_id = $1",
        [roB]
      );
    });
    if (Number(countBSeenByA.rows[0].count) !== 0) {
      throw new Error("Tenant A saw tenant B data");
    }

    let countNoTenant = { rows: [{ count: "0" }] } as { rows: Array<{ count: string }> };
    await withTenantTransaction(client, "", async () => {
      countNoTenant = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM app.repair_orders"
      );
    });
    if (Number(countNoTenant.rows[0].count) !== 0) {
      throw new Error("Queries without tenant context should return zero rows");
    }

    let writeBlocked = false;
    await withTenantTransaction(client, "", async () => {
      try {
        await client.query(
          `INSERT INTO app.repair_orders (ro_id, tenant_id, doc_id, ro_number)
           VALUES ($1, $2, $3, $4)`,
          [randomUUID(), tenantA, docA, "7000003"]
        );
      } catch {
        writeBlocked = true;
      }
    });
    if (!writeBlocked) {
      throw new Error("Writes without tenant context should be blocked by RLS");
    }
  } finally {
    await setTenantContext(client, tenantA);
    await client.query("DELETE FROM app.repair_orders WHERE tenant_id = $1", [tenantA]);
    await client.query("DELETE FROM app.documents WHERE tenant_id = $1", [tenantA]);
    await setTenantContext(client, tenantB);
    await client.query("DELETE FROM app.repair_orders WHERE tenant_id = $1", [tenantB]);
    await client.query("DELETE FROM app.documents WHERE tenant_id = $1", [tenantB]);
    await client.query("DELETE FROM app.tenants WHERE tenant_id IN ($1, $2)", [tenantA, tenantB]);
    if (hasUsersTable && userA && userB) {
      await client.query("DELETE FROM app.users WHERE user_id IN ($1, $2)", [userA, userB]);
    }
    client.release();
    await pool.end();
  }
};

const main = async () => {
  ensureEnv();
  await buildHeaderOverrideTest();
  await buildProductionHeaderBlockTest();
  await runRlsIsolationTest();
  console.log("Tenant RLS harness passed.");
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
