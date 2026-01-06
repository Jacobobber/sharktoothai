import dotenv from "dotenv";
dotenv.config();
import { withRequestContext } from "../../platform/gateway/src/db/pg";
import { sha256 } from "../../shared/utils/hash";
import { storeDocument, storeRepairOrder } from "../../workloads/ro-assistant/src/services/ingest/store";
import { decryptPiiPayload, encryptPiiPayload } from "../../workloads/ro-assistant/src/services/pii/piiEncrypt";
import type { PiiPayload } from "../../workloads/ro-assistant/src/services/pii/piiExtract";
import { writePiiVaultRecord, readPiiVaultRecord } from "../../workloads/ro-assistant/src/services/pii/piiVault";
import { isTenantPiiEnabled } from "../../workloads/ro-assistant/src/services/tenant/tenantConfig";

const ctx = {
  requestId: "pii-test",
  userId: "00000000-0000-0000-0000-000000000001",
  tenantId: "00000000-0000-0000-0000-000000000010",
  role: "ADMIN" as const
};

async function main() {
  let docId: string | null = null;
  let roId: string | null = null;
  const testKey = Buffer.alloc(32, 7).toString("base64");
  process.env.PII_KEY_RING = `test-key:${testKey}`;
  process.env.PII_ACTIVE_KEY = "test-key";

  try {
    const payload: PiiPayload = {
      emails: ["test@example.com"],
      phones: ["555-123-4567"],
      vins: ["1HGCM82633A123456"],
      address: { line1: "123 Main St" }
    };

    const created = await withRequestContext(ctx, async (client) => {
      const updated = await client.query(
        "UPDATE app.tenants SET pii_enabled = true WHERE tenant_id = $1",
        [ctx.tenantId]
      );
      if (updated.rowCount === 0) {
        console.error("Tenant not found for PII enable");
        process.exit(1);
      }

      const enabled = await isTenantPiiEnabled(client, ctx);
      if (!enabled) {
        console.error("PII should be enabled for tenant");
        process.exit(1);
      }

      const seed = `${ctx.requestId}-${Date.now()}`;
      const docId = await storeDocument(client, ctx, {
        filename: "pii-test.txt",
        mimeType: "text/plain",
        sha256Hash: sha256(Buffer.from(seed)),
        storagePath: `ingest/${ctx.tenantId}/${seed}`,
        createdBy: ctx.userId
      });
      const roId = await storeRepairOrder(client, ctx, { docId, roNumber: `PII-TEST-${Date.now()}` });

      const encrypted = await encryptPiiPayload(payload);
      await writePiiVaultRecord(client, ctx, {
        roId,
        customerId: null,
        keyRef: encrypted.keyRef,
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext
      });
      return { docId, roId };
    });

    docId = created.docId;
    roId = created.roId;

    await withRequestContext(ctx, async (client) => {
      const record = await readPiiVaultRecord(client, ctx, roId as string);
      if (!record) {
        console.error("PII vault record missing");
        process.exit(1);
      }
      const decrypted = await decryptPiiPayload({
        keyRef: record.keyRef,
        nonce: record.nonce,
        ciphertext: record.ciphertext
      });
      if (!decrypted.emails?.includes("test@example.com")) {
        console.error("PII vault decrypt failed");
        process.exit(1);
      }
    });

    const ctxDeveloper = { ...ctx, role: "DEVELOPER" as const };
    await withRequestContext(ctxDeveloper, async (client) => {
      const record = await readPiiVaultRecord(client, ctxDeveloper, roId as string);
      if (!record) {
        console.error("PII vault record missing for DEVELOPER");
        process.exit(1);
      }
    });

    const ctxUser = { ...ctx, role: "USER" as const };
    let denied = false;
    await withRequestContext(ctxUser, async (client) => {
      try {
        await writePiiVaultRecord(client, ctxUser, {
          roId: roId as string,
          customerId: null,
          keyRef: "test-key",
          nonce: Buffer.alloc(12, 1),
          ciphertext: Buffer.alloc(32, 2)
        });
      } catch {
        denied = true;
      }
    });
    if (!denied) {
      console.error("PII write was not denied for USER role");
      process.exit(1);
    }

    denied = false;
    await withRequestContext(ctxUser, async (client) => {
      try {
        await readPiiVaultRecord(client, ctxUser, roId as string);
      } catch {
        denied = true;
      }
    });
    if (!denied) {
      console.error("PII read was not denied for USER role");
      process.exit(1);
    }

    await withRequestContext(ctx, async (client) => {
      const chunks = await client.query("SELECT count(*) FROM app.ro_chunks WHERE tenant_id = $1 AND ro_id = $2", [
        ctx.tenantId,
        roId as string
      ]);
      const embeds = await client.query(
        `SELECT count(*) FROM app.ro_embeddings
           WHERE tenant_id = $1
             AND chunk_id IN (SELECT chunk_id FROM app.ro_chunks WHERE tenant_id = $1 AND ro_id = $2)`,
        [ctx.tenantId, roId as string]
      );
      if (Number(chunks.rows[0].count) !== 0 || Number(embeds.rows[0].count) !== 0) {
        console.error("Chunks/embeddings created for PII vault test");
        process.exit(1);
      }
    });

    console.log("PII ingest DB harness passed: vault encrypted, RLS enforced, no chunks/embeddings.");
  } finally {
    if (!docId || !roId) return;
    await withRequestContext(ctx, async (client) => {
      await client.query("DELETE FROM app.pii_vault WHERE tenant_id = $1 AND ro_id = $2", [
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
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
