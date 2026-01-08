import dotenv from "dotenv";
dotenv.config();
import { randomUUID } from "crypto";
import { withRequestContext } from "../../platform/gateway/src/db/pg";
import { AppError } from "../../shared/utils/errors";
import { storeRepairOrder } from "../../workloads/ro-assistant/src/services/ingest/store";
import { encryptPiiPayload } from "../../workloads/ro-assistant/src/services/pii/piiEncrypt";
import type { PiiPayload } from "../../workloads/ro-assistant/src/services/pii/piiExtract";
import { writePiiVaultRecord } from "../../workloads/ro-assistant/src/services/pii/piiVault";

const ctxAdmin = {
  requestId: "pii-vault-ordering-test",
  userId: "00000000-0000-0000-0000-000000000001",
  tenantId: "00000000-0000-0000-0000-000000000010",
  role: "ADMIN" as const
};

const ctxUser = {
  ...ctxAdmin,
  role: "USER" as const
};

async function main() {
  const testKey = Buffer.alloc(32, 11).toString("base64");
  process.env.PII_KEY_RING = `test-key:${testKey}`;
  process.env.PII_ACTIVE_KEY = "test-key";

  const roId = randomUUID();
  const docId = randomUUID();
  const customerUuid = randomUUID();
  const payload: PiiPayload = {
    emails: ["ordering-test@example.com"],
    vins: ["ORDERINGVIN00000001"]
  };

  let vaultConfirmation;
  await withRequestContext(ctxAdmin, async (client) => {
    const encrypted = await encryptPiiPayload(payload);
    try {
      await writePiiVaultRecord(client, ctxUser, {
        roId,
        customerUuid,
        keyRef: encrypted.keyRef,
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext
      });
    } catch (err) {
      if (!(err instanceof AppError) || err.code !== "PII_ROLE_DENIED") {
        throw err;
      }
    }

    try {
      await storeRepairOrder(client, ctxAdmin, {
        docId,
        roNumber: `PII-ORDER-${Date.now()}`,
        customerUuid,
        roId,
        vaultWriteConfirmation: vaultConfirmation as never
      });
      throw new Error("Expected storeRepairOrder to require vault confirmation");
    } catch (err) {
      if (!(err instanceof AppError) || err.code !== "PII_VAULT_REQUIRED") {
        throw err;
      }
    }

    const result = await client.query<{ count: string }>(
      "SELECT count(*) FROM app.repair_orders WHERE tenant_id = $1 AND ro_id = $2",
      [ctxAdmin.tenantId, roId]
    );
    if (Number(result.rows[0]?.count ?? 0) !== 0) {
      throw new Error("Deterministic rows were written despite vault failure");
    }
  });

  console.log("PII vault ordering tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
