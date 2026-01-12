import https from "https";
import { createPublicKey, type KeyObject } from "crypto";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { AppError } from "../../../../../shared/utils/errors";
import { logger } from "../../../../../shared/utils/logger";

type JwksKey = {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
  use?: string;
};

type JwksResponse = {
  keys: JwksKey[];
};

type IngestAadClaims = {
  oid: string;
  tid: string;
  aud: string | string[];
  iss: string;
};

type JwksFetcher = () => Promise<JwksResponse>;

const JWKS_URL = "https://login.microsoftonline.com/common/discovery/v2.0/keys";
const JWKS_TTL_MS = 10 * 60 * 1000;

let cachedKeys: Map<string, KeyObject> | null = null;
let cacheExpiresAt = 0;
let jwksFetcher: JwksFetcher;

const fetchJson = async (url: string): Promise<JwksResponse> =>
  new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          if (res.statusCode && res.statusCode >= 400) {
            return reject(new Error(`JWKS fetch failed (${res.statusCode})`));
          }
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on("error", reject);
  });

const defaultFetchJwks: JwksFetcher = async () => fetchJson(JWKS_URL);

const buildKeyCache = (jwks: JwksResponse) => {
  const map = new Map<string, KeyObject>();
  for (const key of jwks.keys ?? []) {
    if (!key.kid || !key.kty || !key.n || !key.e) continue;
    try {
      const publicKey = createPublicKey({ key, format: "jwk" });
      map.set(key.kid, publicKey);
    } catch (err) {
      logger.warn("Skipping invalid JWKS key", { kid: key.kid });
    }
  }
  return map;
};

const getKeyForKid = async (kid: string): Promise<KeyObject> => {
  const now = Date.now();
  if (!cachedKeys || now >= cacheExpiresAt) {
    const jwks = await jwksFetcher();
    cachedKeys = buildKeyCache(jwks);
    cacheExpiresAt = now + JWKS_TTL_MS;
  }
  let key = cachedKeys.get(kid);
  if (!key) {
    const jwks = await jwksFetcher();
    cachedKeys = buildKeyCache(jwks);
    cacheExpiresAt = Date.now() + JWKS_TTL_MS;
    key = cachedKeys.get(kid);
  }
  if (!key) {
    throw new AppError("Unknown signing key", { status: 401, code: "AAD_JWKS_KID_MISSING" });
  }
  return key;
};

export const setIngestJwksFetcher = (fetcher: JwksFetcher) => {
  jwksFetcher = fetcher;
  cachedKeys = null;
  cacheExpiresAt = 0;
};

export const resetIngestJwksFetcher = () => {
  jwksFetcher = defaultFetchJwks;
  cachedKeys = null;
  cacheExpiresAt = 0;
};

export const verifyIngestAadToken = async (token: string, audience: string): Promise<IngestAadClaims> => {
  if (!jwksFetcher) {
    jwksFetcher = defaultFetchJwks;
  }

  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded !== "object" || !decoded.header?.kid) {
    throw new AppError("Token header missing kid", { status: 401, code: "AAD_TOKEN_INVALID" });
  }

  const key = await getKeyForKid(decoded.header.kid);
  let payload: JwtPayload;
  try {
    const verified = jwt.verify(token, key, { algorithms: ["RS256"], audience });
    if (!verified || typeof verified === "string") {
      throw new AppError("Token payload invalid", { status: 401, code: "AAD_TOKEN_INVALID" });
    }
    payload = verified;
  } catch (err) {
    throw new AppError("Token verification failed", { status: 401, code: "AAD_TOKEN_INVALID" });
  }

  const oid = typeof payload.oid === "string" ? payload.oid : "";
  const tid = typeof payload.tid === "string" ? payload.tid : "";
  const iss = typeof payload.iss === "string" ? payload.iss : "";
  const aud = payload.aud as string | string[] | undefined;
  if (!oid || !tid || !iss || !aud) {
    throw new AppError("Token missing required claims", { status: 401, code: "AAD_TOKEN_INVALID" });
  }

  const expectedIssuerV2 = `https://login.microsoftonline.com/${tid}/v2.0`;
  const expectedIssuerV1 = `https://sts.windows.net/${tid}/`;
  if (iss !== expectedIssuerV2 && iss !== expectedIssuerV1) {
    throw new AppError("Token issuer invalid", { status: 401, code: "AAD_ISSUER_INVALID" });
  }

  return { oid, tid, aud, iss };
};
