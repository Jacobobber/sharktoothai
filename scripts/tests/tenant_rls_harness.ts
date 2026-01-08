import dotenv from "dotenv";
import { Pool, type PoolClient } from "pg";
import { randomUUID } from "crypto";

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
    DEV_TENANT_ID_ADMIN: "00000000-0000-0000-0000-000000000002"
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

const runRlsIsolationTest = async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const docA = randomUUID();
  const docB = randomUUID();
  const roA = randomUUID();
  const roB = randomUUID();

  try {
    await client.query(
      `INSERT INTO app.tenants (tenant_id, name, is_active, pii_enabled)
       VALUES ($1, 'Tenant A', true, true), ($2, 'Tenant B', true, true)`,
      [tenantA, tenantB]
    );

    await setTenantContext(client, tenantA);
    await client.query(
      `INSERT INTO app.documents (doc_id, tenant_id, filename, mime_type, sha256, storage_path)
       VALUES ($1, $2, 'a.xml', 'text/xml', $3, 'ingest/a')`,
      [docA, tenantA, Buffer.from("00", "hex")]
    );
    await client.query(
      `INSERT INTO app.repair_orders (ro_id, tenant_id, doc_id, ro_number)
       VALUES ($1, $2, $3, $4)`,
      [roA, tenantA, docA, "7000001"]
    );

    await setTenantContext(client, tenantB);
    await client.query(
      `INSERT INTO app.documents (doc_id, tenant_id, filename, mime_type, sha256, storage_path)
       VALUES ($1, $2, 'b.xml', 'text/xml', $3, 'ingest/b')`,
      [docB, tenantB, Buffer.from("01", "hex")]
    );
    await client.query(
      `INSERT INTO app.repair_orders (ro_id, tenant_id, doc_id, ro_number)
       VALUES ($1, $2, $3, $4)`,
      [roB, tenantB, docB, "7000002"]
    );

    await setTenantContext(client, tenantA);
    const countA = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM app.repair_orders"
    );
    if (Number(countA.rows[0].count) !== 1) {
      throw new Error("Tenant A should only see its own rows");
    }

    const countBSeenByA = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM app.repair_orders WHERE ro_id = $1",
      [roB]
    );
    if (Number(countBSeenByA.rows[0].count) !== 0) {
      throw new Error("Tenant A saw tenant B data");
    }

    await setTenantContext(client, "");
    const countNoTenant = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM app.repair_orders"
    );
    if (Number(countNoTenant.rows[0].count) !== 0) {
      throw new Error("Queries without tenant context should return zero rows");
    }

    let writeBlocked = false;
    try {
      await client.query(
        `INSERT INTO app.repair_orders (ro_id, tenant_id, doc_id, ro_number)
         VALUES ($1, $2, $3, $4)`,
        [randomUUID(), tenantA, docA, "7000003"]
      );
    } catch {
      writeBlocked = true;
    }
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
