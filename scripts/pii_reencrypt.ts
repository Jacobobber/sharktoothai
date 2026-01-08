import dotenv from "dotenv";
dotenv.config();
import { withRequestContext } from "../platform/gateway/src/db/pg";
import { decryptPiiPayload, encryptPiiPayload } from "../workloads/ro-assistant/src/services/pii/piiEncrypt";
import { writePiiVaultRecord } from "../workloads/ro-assistant/src/services/pii/piiVault";

const ctx = {
  requestId: "pii-reencrypt",
  userId: process.env.PII_REENCRYPT_USER_ID ?? "00000000-0000-0000-0000-000000000001",
  tenantId: process.env.PII_REENCRYPT_TENANT_ID ?? "00000000-0000-0000-0000-000000000010",
  role: "ADMIN" as const
};

async function main() {
  await withRequestContext(ctx, async (client) => {
    const records = await client.query<{
      ro_id: string;
      customer_id: string | null;
      customer_uuid: string | null;
      key_ref: string;
      nonce: Buffer;
      ciphertext: Buffer;
    }>(
      `SELECT ro_id, customer_id, customer_uuid, key_ref, nonce, ciphertext
       FROM app.pii_vault
       WHERE tenant_id = $1`,
      [ctx.tenantId]
    );

    for (const record of records.rows) {
      const payload = await decryptPiiPayload({
        keyRef: record.key_ref,
        nonce: record.nonce,
        ciphertext: record.ciphertext
      });
      const encrypted = await encryptPiiPayload(payload);
      const customerUuid = record.customer_uuid ?? record.customer_id;
      if (!customerUuid) {
        throw new Error(`Missing customer_uuid for ro_id ${record.ro_id}`);
      }
      await writePiiVaultRecord(client, ctx, {
        roId: record.ro_id,
        customerUuid,
        keyRef: encrypted.keyRef,
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext
      });
    }
  });

  console.log("PII re-encryption completed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
