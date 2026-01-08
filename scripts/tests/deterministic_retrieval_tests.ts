import dotenv from "dotenv";
dotenv.config();
import { randomUUID } from "crypto";
import { withRequestContext } from "../../platform/gateway/src/db/pg";
import { sha256 } from "../../shared/utils/hash";
import { answerHandler } from "../../workloads/ro-assistant/src/routes/answer";
import { searchHandler } from "../../workloads/ro-assistant/src/routes/search";

const ctx = {
  requestId: "deterministic-retrieval-test",
  userId: "00000000-0000-0000-0000-000000000001",
  tenantId: "00000000-0000-0000-0000-000000000010",
  role: "ADMIN" as const
};

const buildRes = () => {
  const res: any = {};
  let statusCode = 0;
  let body: any;
  res.status = (code: number) => {
    statusCode = code;
    return res;
  };
  res.json = (payload: any) => {
    body = payload;
    return res;
  };
  return { res, getStatus: () => statusCode, getBody: () => body };
};

async function main() {
  const roId = randomUUID();
  const docId = randomUUID();
  const roNumber = "7000001";
  const customerUuid = randomUUID();
  const seed = `deterministic-${Date.now()}`;
  const digest = sha256(Buffer.from(seed));

  await withRequestContext(ctx, async (client) => {
    await client.query(
      `INSERT INTO app.documents
       (doc_id, tenant_id, filename, mime_type, sha256, storage_path, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        docId,
        ctx.tenantId,
        "deterministic.txt",
        "text/plain",
        Buffer.from(digest, "hex"),
        `ingest/${ctx.tenantId}/${seed}`,
        ctx.userId
      ]
    );
    await client.query(
      `INSERT INTO app.repair_orders (ro_id, tenant_id, doc_id, ro_number, customer_uuid)
       VALUES ($1, $2, $3, $4, $5)`,
      [roId, ctx.tenantId, docId, roNumber, customerUuid]
    );
    await client.query(
      `INSERT INTO app.ro_deterministic_v2
       (ro_id, tenant_id, customer_uuid, ro_number, ro_status, open_timestamp, labor_total, parts_total,
        tax_total, discount_total, grand_total)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        roId,
        ctx.tenantId,
        customerUuid,
        roNumber,
        "OPEN",
        "2026-01-01T09:00:00Z",
        825,
        172,
        0,
        0,
        997
      ]
    );
  });

  const lookupReq: any = {
    body: { question: `RO ${roNumber}` },
    context: ctx
  };
  const lookupRes = buildRes();
  await answerHandler(lookupReq, lookupRes.res, () => undefined);
  if (lookupRes.getStatus() !== 200) {
    throw new Error("Lookup answer failed");
  }
  if (!String(lookupRes.getBody()?.answer ?? "").includes(roNumber)) {
    throw new Error("Lookup answer missing RO number");
  }
  if (!String(lookupRes.getBody()?.answer ?? "").includes("OPEN")) {
    throw new Error("Lookup answer missing deterministic status");
  }
  const lookupSources = lookupRes.getBody()?.sources ?? [];
  if (!lookupSources.length) {
    throw new Error("Lookup answer missing deterministic sources");
  }
  if (!lookupSources.find((source: any) => source.ro_number === roNumber)) {
    throw new Error("Lookup sources missing RO number");
  }
  if (JSON.stringify(lookupSources).includes("customer_uuid")) {
    throw new Error("Lookup sources leaked customer_uuid");
  }

  const costReq: any = {
    body: { question: `total cost for RO ${roNumber}` },
    context: ctx
  };
  const costRes = buildRes();
  await answerHandler(costReq, costRes.res, () => undefined);
  if (costRes.getStatus() !== 200) {
    throw new Error("Cost answer failed");
  }
  if (!String(costRes.getBody()?.answer ?? "").includes("997.00")) {
    throw new Error("Cost answer missing total");
  }
  const costSources = costRes.getBody()?.sources ?? [];
  if (!costSources.length) {
    throw new Error("Cost answer missing deterministic sources");
  }

  const freqReq: any = {
    body: { question: "how many repair orders are there" },
    context: ctx
  };
  const freqRes = buildRes();
  await answerHandler(freqReq, freqRes.res, () => undefined);
  if (freqRes.getStatus() !== 200) {
    throw new Error("Frequency answer failed");
  }
  if (!String(freqRes.getBody()?.answer ?? "").includes("repair orders")) {
    throw new Error("Frequency answer missing aggregate label");
  }

  const searchReq: any = {
    body: { query: `RO ${roNumber}` },
    context: ctx
  };
  const searchRes = buildRes();
  await searchHandler(searchReq, searchRes.res, () => undefined);
  if (searchRes.getStatus() !== 200) {
    throw new Error("Search failed");
  }
  const matches = searchRes.getBody()?.matches ?? [];
  if (!matches.find((match: any) => match.ro_number === roNumber)) {
    throw new Error("Search results missing RO number");
  }

  await withRequestContext(ctx, async (client) => {
    await client.query("DELETE FROM app.ro_deterministic_v2 WHERE tenant_id = $1 AND ro_id = $2", [
      ctx.tenantId,
      roId
    ]);
    await client.query("DELETE FROM app.repair_orders WHERE tenant_id = $1 AND ro_id = $2", [
      ctx.tenantId,
      roId
    ]);
    await client.query("DELETE FROM app.documents WHERE tenant_id = $1 AND doc_id = $2", [
      ctx.tenantId,
      docId
    ]);
  });

  console.log("Deterministic retrieval tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
