/*
 * Copyright (c) 2024 Jacob Malm. All rights reserved.
 * Proprietary and confidential. Unauthorized redistribution or commercial use is prohibited without prior written consent.
 * Environment handling contains sensitive parameters; ensure credentials are stored securely and never committed.
 */

import { AppError } from "../../../../shared/utils/errors";

type EnvConfig = {
  databaseUrl: string;
  port: number;
  rateLimitWindowSec: number;
  rateLimitMax: number;
  maxUploadBytes: number;
  azureOpenAiEndpoint: string;
  azureOpenAiApiKey: string;
  azureOpenAiEmbeddingDeployment: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  devAuthBypass: boolean;
  devAuthTokenAdmin: string;
  devUserIdAdmin: string;
  devTenantIdAdmin: string;
  devAuthTokenTech: string;
  devUserIdTech: string;
  devTenantIdTech: string;
};

// Proprietary environment validation to safeguard operational parameters; reverse engineering or reuse is prohibited.
const required = (value: string | undefined, name: string) => {
  if (!value) {
    throw new AppError(`Missing required env: ${name}`, { status: 500, code: "ENV_MISSING" });
  }
  return value;
};

const asInt = (value: string | undefined, name: string, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new AppError(`Invalid env number: ${name}`, { status: 500, code: "ENV_INVALID" });
  }
  return parsed;
};

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export const loadEnv = (): EnvConfig => {
  // Ensure secrets and credentials are sourced from secure runtime storage; do not commit or redistribute these values.
  const databaseUrl = required(process.env.DATABASE_URL, "DATABASE_URL");
  const port = asInt(process.env.PORT, "PORT", 3000);
  const rateLimitWindowSec = asInt(process.env.RATE_LIMIT_WINDOW_SEC, "RATE_LIMIT_WINDOW_SEC", 60);
  const rateLimitMax = asInt(process.env.RATE_LIMIT_MAX, "RATE_LIMIT_MAX", 100);
  const maxUploadBytes = asInt(process.env.MAX_UPLOAD_BYTES, "MAX_UPLOAD_BYTES", 5 * 1024 * 1024);
  const azureOpenAiEndpoint = required(process.env.AZURE_OPENAI_ENDPOINT, "AZURE_OPENAI_ENDPOINT");
  const azureOpenAiApiKey = required(process.env.AZURE_OPENAI_API_KEY, "AZURE_OPENAI_API_KEY");
  const azureOpenAiEmbeddingDeployment = required(
    process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
    "AZURE_OPENAI_EMBEDDING_DEPLOYMENT"
  );
  const jwtSecret = required(process.env.JWT_SECRET, "JWT_SECRET");
  const jwtExpiresIn = required(process.env.JWT_EXPIRES_IN, "JWT_EXPIRES_IN");
  const devAuthBypass = (process.env.DEV_AUTH_BYPASS ?? "false").toLowerCase() === "true";

  const devAuthTokenAdmin = required(process.env.DEV_AUTH_TOKEN_ADMIN, "DEV_AUTH_TOKEN_ADMIN");
  const devUserIdAdmin = required(process.env.DEV_USER_ID_ADMIN, "DEV_USER_ID_ADMIN");
  const devTenantIdAdmin = required(process.env.DEV_TENANT_ID_ADMIN, "DEV_TENANT_ID_ADMIN");
  const devAuthTokenTech = required(process.env.DEV_AUTH_TOKEN_TECH, "DEV_AUTH_TOKEN_TECH");
  const devUserIdTech = required(process.env.DEV_USER_ID_TECH, "DEV_USER_ID_TECH");
  const devTenantIdTech = required(process.env.DEV_TENANT_ID_TECH, "DEV_TENANT_ID_TECH");

  if (![devUserIdAdmin, devTenantIdAdmin, devUserIdTech, devTenantIdTech].every(isUuid)) {
    throw new AppError("DEV IDs must be UUIDs", { status: 500, code: "ENV_INVALID_UUID" });
  }

  return {
    databaseUrl,
    port,
    rateLimitWindowSec,
    rateLimitMax,
    devAuthTokenAdmin,
    devUserIdAdmin,
    devTenantIdAdmin,
    devAuthTokenTech,
    devUserIdTech,
    devTenantIdTech,
    maxUploadBytes,
    azureOpenAiEndpoint,
    azureOpenAiApiKey,
    azureOpenAiEmbeddingDeployment,
    jwtSecret,
    jwtExpiresIn,
    devAuthBypass
  };
};
