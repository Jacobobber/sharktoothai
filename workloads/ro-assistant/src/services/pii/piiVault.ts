import type { RequestContext } from "../../../../../shared/types/api";
import { AppError } from "../../../../../shared/utils/errors";
import type { DbClient } from "../../../../../platform/gateway/src/db/pg";

export type PiiVaultRecord = {
  tenantId: string;
  roId: string;
  customerId: string | null;
  keyRef: string;
  nonce: Buffer;
  ciphertext: Buffer;
  nameHash: string | null;
  emailHashes: string[] | null;
  phoneHashes: string[] | null;
  vinHashes: string[] | null;
  licensePlateHashes: string[] | null;
  createdAt: string;
  updatedAt: string;
};

const assertAdminWrite = (ctx: RequestContext) => {
  if (ctx.role !== "ADMIN" && ctx.role !== "DEALERADMIN" && ctx.role !== "DEVELOPER") {
    throw new AppError("PII write role denied", { status: 403, code: "PII_ROLE_DENIED" });
  }
};

const assertPiiRead = (ctx: RequestContext) => {
  if (ctx.role !== "ADMIN" && ctx.role !== "DEALERADMIN" && ctx.role !== "DEVELOPER") {
    throw new AppError("PII read role denied", { status: 403, code: "PII_ROLE_DENIED" });
  }
};

export const writePiiVaultRecord = async (
  client: DbClient,
  ctx: RequestContext,
  input: {
    roId: string;
    customerId: string | null;
    keyRef: string;
    nonce: Buffer;
    ciphertext: Buffer;
    nameHash?: string;
    emailHashes?: string[];
    phoneHashes?: string[];
    vinHashes?: string[];
    licensePlateHashes?: string[];
  }
): Promise<void> => {
  assertAdminWrite(ctx);
  await client.query(
    `INSERT INTO app.pii_vault
     (tenant_id, ro_id, customer_id, key_ref, nonce, ciphertext, name_hash, email_hashes, phone_hashes, vin_hashes, license_plate_hashes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (tenant_id, ro_id)
     DO UPDATE SET customer_id = EXCLUDED.customer_id,
                   key_ref = EXCLUDED.key_ref,
                   nonce = EXCLUDED.nonce,
                   ciphertext = EXCLUDED.ciphertext,
                   name_hash = EXCLUDED.name_hash,
                   email_hashes = EXCLUDED.email_hashes,
                   phone_hashes = EXCLUDED.phone_hashes,
                   vin_hashes = EXCLUDED.vin_hashes,
                   license_plate_hashes = EXCLUDED.license_plate_hashes,
                   updated_at = now()`,
    [
      ctx.tenantId,
      input.roId,
      input.customerId,
      input.keyRef,
      input.nonce,
      input.ciphertext,
      input.nameHash ?? null,
      input.emailHashes?.length ? input.emailHashes : null,
      input.phoneHashes?.length ? input.phoneHashes : null,
      input.vinHashes?.length ? input.vinHashes : null,
      input.licensePlateHashes?.length ? input.licensePlateHashes : null
    ]
  );
};

export const readPiiVaultRecord = async (
  client: DbClient,
  ctx: RequestContext,
  roId: string
): Promise<PiiVaultRecord | null> => {
  assertPiiRead(ctx);
  const result = await client.query<PiiVaultRecord>(
    `SELECT tenant_id AS "tenantId",
            ro_id AS "roId",
            customer_id AS "customerId",
            key_ref AS "keyRef",
            nonce,
            ciphertext,
            name_hash AS "nameHash",
            email_hashes AS "emailHashes",
            phone_hashes AS "phoneHashes",
            vin_hashes AS "vinHashes",
            license_plate_hashes AS "licensePlateHashes",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
     FROM app.pii_vault
     WHERE tenant_id = $1 AND ro_id = $2`,
    [ctx.tenantId, roId]
  );
  return result.rows[0] ?? null;
};

export const findCustomerIdByHashes = async (
  client: DbClient,
  ctx: RequestContext,
  hashes: string[]
): Promise<string | null> => {
  assertPiiRead(ctx);
  if (!hashes.length) return null;
  const result = await client.query<{ customer_id: string }>(
    `SELECT customer_id
     FROM app.pii_vault
     WHERE tenant_id = $1
       AND customer_id IS NOT NULL
       AND (
         name_hash = ANY($2)
         OR (email_hashes IS NOT NULL AND email_hashes && $2)
         OR (phone_hashes IS NOT NULL AND phone_hashes && $2)
         OR (vin_hashes IS NOT NULL AND vin_hashes && $2)
         OR (license_plate_hashes IS NOT NULL AND license_plate_hashes && $2)
       )
     LIMIT 1`,
    [ctx.tenantId, hashes]
  );
  return result.rows[0]?.customer_id ?? null;
};
