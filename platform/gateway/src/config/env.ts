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
  azureOpenAiApiVersion: string;
  azureOpenAiChatEndpoint?: string;
  azureOpenAiChatDeployment?: string;
  azureOpenAiChatApiVersion?: string;
  azureOpenAiChatApiKey?: string;
  ragLlmEnabled: boolean;
  ragLlmMaxTokens: number;
  ragLlmTemperature: number;
  jwtSecret: string;
  jwtExpiresIn: string;
  devAuthBypass: boolean;
  devAuthTokenAdmin: string;
  devUserIdAdmin: string;
  devTenantIdAdmin: string;
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
  const azureOpenAiApiVersion = required(process.env.AZURE_OPENAI_API_VERSION, "AZURE_OPENAI_API_VERSION");
  const azureOpenAiChatEndpoint = process.env.AZURE_OPENAI_CHAT_ENDPOINT;
  const azureOpenAiChatDeployment = process.env.AZURE_OPENAI_CHAT_DEPLOYMENT;
  const azureOpenAiChatApiVersion = process.env.AZURE_OPENAI_CHAT_API_VERSION;
  const azureOpenAiChatApiKey = process.env.AZURE_OPENAI_CHAT_API_KEY;
  const ragLlmEnabled = (process.env.RAG_LLM_ENABLED ?? "false").toLowerCase() === "true";
  const ragLlmMaxTokens = asInt(process.env.RAG_LLM_MAX_TOKENS, "RAG_LLM_MAX_TOKENS", 350);
  const temperatureRaw = process.env.RAG_LLM_TEMPERATURE;
  const parsedTemperature = temperatureRaw !== undefined ? Number(temperatureRaw) : 0.2;
  const ragLlmTemperature = Number.isFinite(parsedTemperature) ? parsedTemperature : 0.2;
  const jwtSecret = required(process.env.JWT_SECRET, "JWT_SECRET");
  const jwtExpiresIn = required(process.env.JWT_EXPIRES_IN, "JWT_EXPIRES_IN");
  const devAuthBypass = (process.env.DEV_AUTH_BYPASS ?? "false").toLowerCase() === "true";

  const devAuthTokenAdmin = required(process.env.DEV_AUTH_TOKEN_ADMIN, "DEV_AUTH_TOKEN_ADMIN");
  const devUserIdAdmin = required(process.env.DEV_USER_ID_ADMIN, "DEV_USER_ID_ADMIN");
  const devTenantIdAdmin = required(process.env.DEV_TENANT_ID_ADMIN, "DEV_TENANT_ID_ADMIN");

  if (![devUserIdAdmin, devTenantIdAdmin].every(isUuid)) {
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
    maxUploadBytes,
    azureOpenAiEndpoint,
    azureOpenAiApiKey,
    azureOpenAiEmbeddingDeployment,
    azureOpenAiApiVersion,
    azureOpenAiChatEndpoint,
    azureOpenAiChatDeployment,
    azureOpenAiChatApiVersion,
    azureOpenAiChatApiKey,
    ragLlmEnabled,
    ragLlmMaxTokens,
    ragLlmTemperature,
    jwtSecret,
    jwtExpiresIn,
    devAuthBypass
  };
};
