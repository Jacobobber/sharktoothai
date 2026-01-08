import { randomUUID } from "crypto";
import type { RequestContext } from "../../../../../shared/types/api";
import { AppError } from "../../../../../shared/utils/errors";
import type { DbClient } from "../../../../../platform/gateway/src/db/pg";
import type { PiiPayload } from "../pii/piiExtract";
import { buildPiiHashes } from "../pii/piiHash";
import { findCustomerUuidByHashes } from "../pii/piiVault";

export type CustomerIdentity = {
  customerUuid: string;
  hashes: string[];
  nameHash?: string;
  emailHashes: string[];
  phoneHashes: string[];
  vinHashes: string[];
  licensePlateHashes: string[];
  addressHash?: string;
};

export const resolveCustomerIdentity = async (
  client: DbClient,
  ctx: RequestContext,
  piiPayload: PiiPayload | null
): Promise<CustomerIdentity> => {
  if (!piiPayload) {
    throw new AppError("PII payload missing for customer identity", {
      status: 400,
      code: "CUSTOMER_IDENTITY_MISSING"
    });
  }

  const hashes = buildPiiHashes({
    customerName: piiPayload.customerName,
    emails: piiPayload.emails,
    phones: piiPayload.phones,
    vins: piiPayload.vins,
    licensePlates: piiPayload.licensePlates,
    address: piiPayload.address
  });

  const hashList = [
    hashes.nameHash,
    ...hashes.emailHashes,
    ...hashes.phoneHashes,
    ...hashes.vinHashes,
    ...hashes.licensePlateHashes,
    hashes.addressHash
  ].filter(Boolean) as string[];

  if (!hashList.length) {
    throw new AppError("Insufficient PII for customer identity", {
      status: 400,
      code: "CUSTOMER_IDENTITY_EMPTY"
    });
  }

  const existing = await findCustomerUuidByHashes(client, ctx, hashList);
  return {
    customerUuid: existing ?? randomUUID(),
    hashes: hashList,
    nameHash: hashes.nameHash,
    emailHashes: hashes.emailHashes,
    phoneHashes: hashes.phoneHashes,
    vinHashes: hashes.vinHashes,
    licensePlateHashes: hashes.licensePlateHashes,
    addressHash: hashes.addressHash
  };
};
