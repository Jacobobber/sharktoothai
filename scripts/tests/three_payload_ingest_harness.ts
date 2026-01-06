import dotenv from "dotenv";
dotenv.config();
import { withRequestContext } from "../../platform/gateway/src/db/pg";
import { sha256 } from "../../shared/utils/hash";
import {
  storeDocument,
  storeRepairOrder,
  ensureChunkTables,
  storeChunksAndEmbeddings,
  storeRepairOrderDetails
} from "../../workloads/ro-assistant/src/services/ingest/store";
import { chunkText } from "../../workloads/ro-assistant/src/services/ingest/chunk";
import { embedChunks } from "../../workloads/ro-assistant/src/services/ingest/embed";
import { encryptPiiPayload } from "../../workloads/ro-assistant/src/services/pii/piiEncrypt";
import { writePiiVaultRecord, readPiiVaultRecord } from "../../workloads/ro-assistant/src/services/pii/piiVault";
import { buildPiiHashes } from "../../workloads/ro-assistant/src/services/pii/piiHash";
import { isTenantPiiEnabled } from "../../workloads/ro-assistant/src/services/tenant/tenantConfig";
import {
  routeXmlToPayloads,
  assertNoPiiInSemantic,
  validateRoutedPayloads,
  buildSemanticXml,
  stripXmlTags
} from "../../workloads/ro-assistant/src/services/ingest/xmlFieldRouting";
import { redactPii } from "../../workloads/ro-assistant/src/services/ingest/redact";

const ctx = {
  requestId: "three-payload-test",
  userId: "00000000-0000-0000-0000-000000000001",
  tenantId: "00000000-0000-0000-0000-000000000010",
  role: "ADMIN" as const
};

const buildXml = (roNumber: string) => `<?xml version="1.0" encoding="UTF-8"?>
<REPAIR_ORDER>
  <RO_NUMBER>${roNumber}</RO_NUMBER>
  <RO_STATUS>OPEN</RO_STATUS>
  <OPEN_TIMESTAMP>2026-01-01T09:00:00Z</OPEN_TIMESTAMP>
  <CLOSE_TIMESTAMP>2026-01-02T16:00:00Z</CLOSE_TIMESTAMP>
  <ADVISOR_ID>ADV-100</ADVISOR_ID>
  <SERVICE_LANE>LANE-1</SERVICE_LANE>
  <VEHICLE_YEAR>2022</VEHICLE_YEAR>
  <VEHICLE_MAKE>Honda</VEHICLE_MAKE>
  <VEHICLE_MODEL>Civic</VEHICLE_MODEL>
  <VIN>SYNTHVIN0000000001</VIN>
  <CUSTOMER_FIRST_NAME>Jane</CUSTOMER_FIRST_NAME>
  <CUSTOMER_LAST_NAME>Smith</CUSTOMER_LAST_NAME>
  <CUSTOMER_EMAIL>jane.smith@example.test</CUSTOMER_EMAIL>
  <CUSTOMER_PHONE>555-222-3333</CUSTOMER_PHONE>
  <CUSTOMER_ADDRESS_LINE1>123 Main St</CUSTOMER_ADDRESS_LINE1>
  <CUSTOMER_ADDRESS_CITY>Phoenix</CUSTOMER_ADDRESS_CITY>
  <CUSTOMER_ADDRESS_STATE>AZ</CUSTOMER_ADDRESS_STATE>
  <CUSTOMER_ADDRESS_POSTAL>85001</CUSTOMER_ADDRESS_POSTAL>
  <LICENSE_PLATE>ABC1234</LICENSE_PLATE>
  <CUSTOMER_COMPLAINT>Customer reports squealing brakes.</CUSTOMER_COMPLAINT>
  <LABOR_LINE_NUMBER_1>1</LABOR_LINE_NUMBER_1>
  <OP_CODE_1>BRK01</OP_CODE_1>
  <OP_DESCRIPTION_1>Replace front brake pads</OP_DESCRIPTION_1>
  <ACTUAL_HOURS_1>1.0</ACTUAL_HOURS_1>
  <LABOR_RATE_1>275.00</LABOR_RATE_1>
  <LABOR_EXTENDED_AMOUNT_1>275.00</LABOR_EXTENDED_AMOUNT_1>
  <TECHNICIAN_ID_1>TECH-9</TECHNICIAN_ID_1>
  <TECHNICIAN_NOTES_1>Brake pads worn below spec.</TECHNICIAN_NOTES_1>
  <PART_LINE_NUMBER_1_1>1</PART_LINE_NUMBER_1_1>
  <PART_NUMBER_1_1>BRK-PAD-001</PART_NUMBER_1_1>
  <PART_DESCRIPTION_1_1>Front brake pad set</PART_DESCRIPTION_1_1>
  <PART_QUANTITY_1_1>1</PART_QUANTITY_1_1>
  <PART_UNIT_PRICE_1_1>148.00</PART_UNIT_PRICE_1_1>
  <PART_EXTENDED_PRICE_1_1>148.00</PART_EXTENDED_PRICE_1_1>
  <PART_LINE_NUMBER_1_2>2</PART_LINE_NUMBER_1_2>
  <PART_NUMBER_1_2>BRK-FLUID-01</PART_NUMBER_1_2>
  <PART_DESCRIPTION_1_2>Brake fluid</PART_DESCRIPTION_1_2>
  <PART_QUANTITY_1_2>1</PART_QUANTITY_1_2>
  <PART_UNIT_PRICE_1_2>24.00</PART_UNIT_PRICE_1_2>
  <PART_EXTENDED_PRICE_1_2>24.00</PART_EXTENDED_PRICE_1_2>
  <LABOR_LINE_NUMBER_2>2</LABOR_LINE_NUMBER_2>
  <OP_CODE_2>BRK02</OP_CODE_2>
  <OP_DESCRIPTION_2>Inspect rear brakes</OP_DESCRIPTION_2>
  <ACTUAL_HOURS_2>2.0</ACTUAL_HOURS_2>
  <LABOR_EXTENDED_AMOUNT_2>550.00</LABOR_EXTENDED_AMOUNT_2>
  <TECHNICIAN_ID_2>TECH-12</TECHNICIAN_ID_2>
  <LABOR_TOTAL>825.00</LABOR_TOTAL>
  <PARTS_TOTAL>172.00</PARTS_TOTAL>
  <SHOP_FEES>0.00</SHOP_FEES>
  <ENVIRONMENTAL_FEES>0.00</ENVIRONMENTAL_FEES>
  <TAX_TOTAL>0.00</TAX_TOTAL>
  <DISCOUNT_TOTAL>0.00</DISCOUNT_TOTAL>
  <GRAND_TOTAL>997.00</GRAND_TOTAL>
</REPAIR_ORDER>`;

const piiValues = [
  "Jane Smith",
  "jane.smith@example.test",
  "555-222-3333",
  "SYNTHVIN0000000001",
  "ABC1234",
  "123 Main St"
];

let docId: string | null = null;
let roId: string | null = null;
let roNumber: string | null = null;

async function main() {
  const testKey = Buffer.alloc(32, 9).toString("base64");
  process.env.PII_KEY_RING_SECRET = "";
  process.env.PII_KEY_RING = `test-key:${testKey}`;
  process.env.PII_ACTIVE_KEY = "test-key";

  const nextRo = await withRequestContext(ctx, async (client) => {
    const result = await client.query<{ max_ro: string | null }>(
      `SELECT MAX(CAST(ro_number AS bigint)) AS max_ro
       FROM app.repair_orders
       WHERE tenant_id = $1 AND ro_number ~ '^[0-9]{7}$'`,
      [ctx.tenantId]
    );
    const maxValue = result.rows[0]?.max_ro ? Number.parseInt(result.rows[0].max_ro, 10) : 6919999;
    return String(maxValue + 1).padStart(7, "0");
  });
  roNumber = nextRo;
  const xml = buildXml(roNumber);
  const routed = routeXmlToPayloads(xml);
  assertNoPiiInSemantic(routed.semanticPayload);

  const piiEnabled = await withRequestContext(ctx, async (client) => {
    const updated = await client.query(
      "UPDATE app.tenants SET pii_enabled = true WHERE tenant_id = $1",
      [ctx.tenantId]
    );
    if (updated.rowCount === 0) {
      throw new Error("Tenant not found for PII enable");
    }
    return isTenantPiiEnabled(client, ctx);
  });

  validateRoutedPayloads({
    deterministicPayload: routed.deterministicPayload,
    piiPayload: routed.piiPayload,
    semanticPayload: routed.semanticPayload,
    piiEnabled
  });

  await withRequestContext(ctx, async (client) => {
    await ensureChunkTables(client);
    const docSeed = `${ctx.requestId}-${Date.now()}`;
    docId = await storeDocument(client, ctx, {
      filename: "ro-test.xml",
      mimeType: "application/xml",
      sha256Hash: sha256(Buffer.from(docSeed)),
      storagePath: `ingest/${ctx.tenantId}/${docSeed}`,
      createdBy: ctx.userId
    });
    roId = await storeRepairOrder(client, ctx, { docId, roNumber: roNumber as string });

    if (!routed.piiPayload) {
      throw new Error("PII payload missing");
    }
    const encrypted = await encryptPiiPayload(routed.piiPayload);
    const hashes = buildPiiHashes(routed.piiPayload);
    await writePiiVaultRecord(client, ctx, {
      roId,
      customerId: null,
      keyRef: encrypted.keyRef,
      nonce: encrypted.nonce,
      ciphertext: encrypted.ciphertext,
      nameHash: hashes.nameHash,
      emailHashes: hashes.emailHashes,
      phoneHashes: hashes.phoneHashes,
      vinHashes: hashes.vinHashes,
      licensePlateHashes: hashes.licensePlateHashes
    });

    await storeRepairOrderDetails(client, ctx, roId, routed.deterministicPayload);

    const semanticXml = buildSemanticXml(routed.semanticPayload);
    const redactedXml = redactPii(semanticXml);
    const semanticText = stripXmlTags(redactedXml);
    const chunks = chunkText(semanticText);
    const embeddings = await embedChunks(chunks);
    await storeChunksAndEmbeddings(client, ctx, { roId, chunks, embeddings });
  });

  await withRequestContext(ctx, async (client) => {
    const record = await readPiiVaultRecord(client, ctx, roId as string);
    if (!record || !record.ciphertext || record.ciphertext.length === 0) {
      throw new Error("PII vault ciphertext missing");
    }

    const chunkRows = await client.query<{ chunk_text: string }>(
      `SELECT chunk_text
       FROM app.ro_chunks
       WHERE tenant_id = $1 AND ro_id = $2`,
      [ctx.tenantId, roId]
    );
    const combined = chunkRows.rows.map((row) => row.chunk_text).join(" ");
    for (const value of piiValues) {
      if (combined.includes(value)) {
        throw new Error(`PII leaked into chunks: ${value}`);
      }
    }
  });

  console.log("Three-payload ingest harness passed.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    if (!docId || !roId) return;
    await withRequestContext(ctx, async (client) => {
      await client.query("DELETE FROM app.pii_vault WHERE tenant_id = $1 AND ro_id = $2", [
        ctx.tenantId,
        roId
      ]);
      await client.query("DELETE FROM app.ro_chunks WHERE tenant_id = $1 AND ro_id = $2", [
        ctx.tenantId,
        roId
      ]);
      await client.query(
        `DELETE FROM app.ro_embeddings
         WHERE tenant_id = $1
           AND chunk_id IN (SELECT chunk_id FROM app.ro_chunks WHERE tenant_id = $1 AND ro_id = $2)`,
        [ctx.tenantId, roId]
      );
      await client.query("DELETE FROM app.ro_labor_lines WHERE tenant_id = $1 AND ro_id = $2", [
        ctx.tenantId,
        roId
      ]);
      await client.query("DELETE FROM app.ro_parts_lines WHERE tenant_id = $1 AND ro_id = $2", [
        ctx.tenantId,
        roId
      ]);
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
  });
