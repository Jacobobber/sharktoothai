import type { RequestContext } from "../../../../../shared/types/api";
import { AppError } from "../../../../../shared/utils/errors";
import type { DbClient } from "../../../../../platform/gateway/src/db/pg";

export type VaultWriteConfirmation = {
  vaultWriteConfirmed: true;
};

const assertAdminWrite = (ctx: RequestContext) => {
  if (ctx.role !== "ADMIN" && ctx.role !== "DEALERADMIN" && ctx.role !== "DEVELOPER") {
    throw new AppError("PII write role denied", { status: 403, code: "PII_ROLE_DENIED" });
  }
};

export const writePiiVaultRecord = async (
  client: DbClient,
  ctx: RequestContext,
  input: {
    roId: string;
    customerUuid: string;
    keyRef: string;
    nonce: Buffer;
    ciphertext: Buffer;
    nameHash?: string;
    emailHashes?: string[];
    phoneHashes?: string[];
    vinHashes?: string[];
    licensePlateHashes?: string[];
    addressHash?: string;
  }
): Promise<VaultWriteConfirmation> => {
  assertAdminWrite(ctx);
  await client.query(
    `INSERT INTO app.pii_vault
     (tenant_id, ro_id, customer_id, customer_uuid, key_ref, nonce, ciphertext, name_hash, email_hashes, phone_hashes, vin_hashes, license_plate_hashes, address_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (tenant_id, ro_id)
     DO UPDATE SET customer_id = EXCLUDED.customer_id,
                   customer_uuid = EXCLUDED.customer_uuid,
                   key_ref = EXCLUDED.key_ref,
                   nonce = EXCLUDED.nonce,
                   ciphertext = EXCLUDED.ciphertext,
                   name_hash = EXCLUDED.name_hash,
                   email_hashes = EXCLUDED.email_hashes,
                   phone_hashes = EXCLUDED.phone_hashes,
                   vin_hashes = EXCLUDED.vin_hashes,
                   license_plate_hashes = EXCLUDED.license_plate_hashes,
                   address_hash = EXCLUDED.address_hash,
                   updated_at = now()`,
    [
      ctx.tenantId,
      input.roId,
      input.customerUuid,
      input.customerUuid,
      input.keyRef,
      input.nonce,
      input.ciphertext,
      input.nameHash ?? null,
      input.emailHashes?.length ? input.emailHashes : null,
      input.phoneHashes?.length ? input.phoneHashes : null,
      input.vinHashes?.length ? input.vinHashes : null,
      input.licensePlateHashes?.length ? input.licensePlateHashes : null,
      input.addressHash ?? null
    ]
  );
  return { vaultWriteConfirmed: true };
};

export const findCustomerUuidByHashes = async (
  client: DbClient,
  ctx: RequestContext,
  hashes: string[]
): Promise<string | null> => {
  if (!hashes.length) return null;
  const result = await client.query<{ customer_uuid: string | null; customer_id: string | null }>(
    `SELECT customer_uuid, customer_id
     FROM app.pii_vault
     WHERE tenant_id = $1
       AND (customer_uuid IS NOT NULL OR customer_id IS NOT NULL)
       AND (
         name_hash = ANY($2)
         OR (email_hashes IS NOT NULL AND email_hashes && $2)
         OR (phone_hashes IS NOT NULL AND phone_hashes && $2)
         OR (vin_hashes IS NOT NULL AND vin_hashes && $2)
         OR (license_plate_hashes IS NOT NULL AND license_plate_hashes && $2)
         OR address_hash = ANY($2)
       )
     LIMIT 1`,
    [ctx.tenantId, hashes]
  );
  return result.rows[0]?.customer_uuid ?? result.rows[0]?.customer_id ?? null;
};
