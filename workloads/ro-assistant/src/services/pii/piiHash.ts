import { createHmac } from "crypto";

const normalizeValue = (value: string) => value.trim().toLowerCase();

const normalizePhone = (value: string) => value.replace(/\D/g, "");

const normalizeVin = (value: string) => value.replace(/\s+/g, "").toUpperCase();

const normalizeLicensePlate = (value: string) => value.replace(/\s+/g, "").toUpperCase();

const getHashKey = (): string => {
  return process.env.PII_HASH_KEY ?? process.env.PII_VAULT_KEY ?? "";
};

const hashValue = (value: string): string => {
  const key = getHashKey();
  if (!key) {
    throw new Error("PII hash key not configured");
  }
  return createHmac("sha256", key).update(value).digest("hex");
};

export type PiiHashes = {
  nameHash?: string;
  emailHashes: string[];
  phoneHashes: string[];
  vinHashes: string[];
  licensePlateHashes: string[];
  addressHash?: string;
};

export const buildPiiHashes = (input: {
  customerName?: string;
  emails?: string[];
  phones?: string[];
  vins?: string[];
  licensePlates?: string[];
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
}): PiiHashes => {
  const nameHash = input.customerName ? hashValue(normalizeValue(input.customerName)) : undefined;
  const emailHashes = (input.emails ?? []).map((email) => hashValue(normalizeValue(email)));
  const phoneHashes = (input.phones ?? []).map((phone) => {
    const normalized = normalizePhone(phone);
    return normalized ? hashValue(normalized) : "";
  }).filter(Boolean);
  const vinHashes = (input.vins ?? []).map((vin) => hashValue(normalizeVin(vin)));
  const licensePlateHashes = (input.licensePlates ?? []).map((plate) =>
    hashValue(normalizeLicensePlate(plate))
  );
  const addressParts = [
    input.address?.line1,
    input.address?.line2,
    input.address?.city,
    input.address?.state,
    input.address?.zip
  ]
    .map((part) => (part ?? "").trim())
    .filter(Boolean);
  const addressHash =
    addressParts.length > 0 ? hashValue(normalizeValue(addressParts.join("|"))) : undefined;

  return {
    nameHash,
    emailHashes,
    phoneHashes,
    vinHashes,
    licensePlateHashes,
    addressHash
  };
};
