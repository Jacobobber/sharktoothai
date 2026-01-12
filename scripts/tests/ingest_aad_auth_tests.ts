import { createPublicKey, generateKeyPairSync, randomUUID } from "crypto";
import type { Response } from "express";
import jwt from "jsonwebtoken";
import { setIngestJwksFetcher } from "../../platform/gateway/src/core/auth/ingestAad";

type MockRes = {
  statusCode: number;
  body?: any;
  status: (code: number) => MockRes;
  json: (payload: any) => MockRes;
};

const ensureEnv = (allowedOid: string, audience: string) => {
  const defaults: Record<string, string> = {
    DATABASE_URL: "postgres://user:pass@localhost:5432/db",
    PORT: "3000",
    AZURE_SUBSCRIPTION_ID: randomUUID(),
    AZURE_RESOURCE_GROUP: "rg-test",
    AZURE_STORAGE_ACCOUNT_NAME: "storageacct",
    AZURE_OPENAI_ENDPOINT: "https://example.invalid",
    AZURE_OPENAI_API_KEY: "test-key",
    AZURE_OPENAI_EMBEDDING_DEPLOYMENT: "test-embed",
    AZURE_OPENAI_API_VERSION: "2024-02-15-preview",
    JWT_SECRET: "test-secret",
    JWT_EXPIRES_IN: "1h",
    DEV_AUTH_TOKEN_ADMIN: "dev-token",
    DEV_USER_ID_ADMIN: "00000000-0000-0000-0000-000000000001",
    DEV_TENANT_ID_ADMIN: "00000000-0000-0000-0000-000000000002",
    INGEST_AAD_AUDIENCE: audience,
    INGEST_ALLOWED_CALLER_OBJECT_IDS: allowedOid
  };

  Object.entries(defaults).forEach(([key, value]) => {
    if (!process.env[key]) process.env[key] = value;
  });
};

const createMockRes = (): Response & MockRes => {
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
  return res as Response & MockRes;
};

const buildToken = (opts: {
  oid: string;
  tid: string;
  aud: string;
  issuer: string;
  privateKey: string;
  kid: string;
}) =>
  jwt.sign(
    { oid: opts.oid, tid: opts.tid },
    opts.privateKey,
    {
      algorithm: "RS256",
      keyid: opts.kid,
      audience: opts.aud,
      issuer: opts.issuer,
      expiresIn: "5m"
    }
  );

const run = async () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicJwk = createPublicKey(publicKey).export({ format: "jwk" }) as { n?: string; e?: string };
  const kid = "test-kid";
  const allowedOid = randomUUID();
  const disallowedOid = randomUUID();
  const tid = randomUUID();
  const audience = "api://ingest";
  const issuer = `https://login.microsoftonline.com/${tid}/v2.0`;
  ensureEnv(allowedOid, audience);

  setIngestJwksFetcher(async () => ({
    keys: [
      {
        kid,
        kty: "RSA",
        n: publicJwk.n ?? "",
        e: publicJwk.e ?? "",
        alg: "RS256",
        use: "sig"
      }
    ]
  }));

  const { ingestAadAuth, setIngestAuthAuditLogger } = await import(
    "../../platform/gateway/src/http/middleware/ingestAadAuth"
  );
  setIngestAuthAuditLogger(async () => undefined);

  const tenantId = randomUUID();
  const validToken = buildToken({
    oid: allowedOid,
    tid,
    aud: audience,
    issuer,
    privateKey: privateKey.export({ format: "pem", type: "pkcs1" }).toString(),
    kid
  });
  const deniedToken = buildToken({
    oid: disallowedOid,
    tid,
    aud: audience,
    issuer,
    privateKey: privateKey.export({ format: "pem", type: "pkcs1" }).toString(),
    kid
  });

  {
    const req: any = {
      path: "/workloads/ro/ingest-from-storage",
      headers: {},
      header(name: string) {
        return this.headers[name.toLowerCase()];
      },
      body: { tenant_id: tenantId }
    };
    const res = createMockRes();
    await ingestAadAuth(req, res, () => {});
    if (res.statusCode !== 401 || res.body?.error !== "INGEST_AUTH_REQUIRED") {
      throw new Error("Expected missing token to return 401");
    }
  }

  {
    const req: any = {
      path: "/workloads/ro/ingest-from-storage",
      headers: { authorization: "Bearer not-a-token" },
      header(name: string) {
        return this.headers[name.toLowerCase()];
      },
      body: { tenant_id: tenantId }
    };
    const res = createMockRes();
    await ingestAadAuth(req, res, () => {});
    if (res.statusCode !== 401) {
      throw new Error("Expected invalid token to return 401");
    }
  }

  {
    const req: any = {
      path: "/workloads/ro/ingest-from-storage",
      headers: { authorization: `Bearer ${deniedToken}` },
      header(name: string) {
        return this.headers[name.toLowerCase()];
      },
      body: { tenant_id: tenantId }
    };
    const res = createMockRes();
    await ingestAadAuth(req, res, () => {});
    if (res.statusCode !== 403 || res.body?.error !== "INGEST_CALLER_FORBIDDEN") {
      throw new Error("Expected disallowed caller to return 403");
    }
  }

  {
    const req: any = {
      path: "/workloads/ro/ingest-from-storage",
      headers: { authorization: `Bearer ${validToken}` },
      header(name: string) {
        return this.headers[name.toLowerCase()];
      },
      body: { tenant_id: tenantId }
    };
    const res = createMockRes();
    let nextCalled = false;
    await ingestAadAuth(req, res, () => {
      nextCalled = true;
    });
    if (!nextCalled) {
      throw new Error("Expected allowlisted token to proceed");
    }
    if (req.context?.userId !== allowedOid || req.context?.tenantId !== tenantId || req.context?.role !== "ADMIN") {
      throw new Error("Expected ingest context to be populated");
    }
  }

  console.log("Ingest AAD auth tests passed.");
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
