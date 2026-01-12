import { AppError } from "../../../../../shared/utils/errors";
import { loadEnv } from "../../config/env";
import { getArmAccessToken } from "./armToken";

export type SftpProvisioningDetails = {
  username: string;
  host: string;
  homeDirectory: string;
  homeUri: string;
  container: string;
  prefix: string;
};

type AzureArmError = {
  code: string;
  message: string;
};

const env = loadEnv();

const getSftpHost = () => env.publicSftpHostname;

const buildLocalUserUrl = (username: string) =>
  `https://management.azure.com/subscriptions/${env.azureSubscriptionId}` +
  `/resourceGroups/${env.azureResourceGroup}` +
  `/providers/Microsoft.Storage/storageAccounts/${env.azureStorageAccountName}` +
  `/localUsers/${encodeURIComponent(username)}` +
  `?api-version=${encodeURIComponent(env.azureArmApiVersion)}`;

export const buildSftpUsername = (tenantId: string) => `tenant_${tenantId}`;

export const buildSftpHomeDirectory = (containerName: string, tenantId: string) =>
  `${containerName}/tenant=${tenantId}/`;

export const buildSftpHomeUri = (host: string, homeDirectory: string) => `sftp://${host}/${homeDirectory}`;

export const buildSftpLocalUserPayload = (tenantId: string, publicKey: string) => ({
  properties: {
    hasSshKey: true,
    hasSharedKey: false,
    hasPassword: false,
    homeDirectory: buildSftpHomeDirectory(env.azureStorageContainerName, tenantId),
    permissionScopes: [
      {
        permissions: "w",
        service: "blob",
        resourceName: env.azureStorageContainerName
      }
    ],
    sshAuthorizedKeys: [
      {
        description: "tenant-upload-key",
        key: publicKey
      }
    ]
  }
});

const parseArmError = async (response: Response): Promise<AzureArmError> => {
  try {
    const data = (await response.json()) as { error?: { code?: string; message?: string } };
    return {
      code: data?.error?.code ?? "ARM_REQUEST_FAILED",
      message: data?.error?.message ?? `ARM request failed (${response.status})`
    };
  } catch {
    return { code: "ARM_REQUEST_FAILED", message: `ARM request failed (${response.status})` };
  }
};

const armRequest = async (method: string, url: string, body?: unknown): Promise<Response> => {
  const token = await getArmAccessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
  return fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
};

export const provisionSftpLocalUser = async (
  tenantId: string,
  publicKey: string
): Promise<SftpProvisioningDetails> => {
  const username = buildSftpUsername(tenantId);
  const url = buildLocalUserUrl(username);
  const payload = buildSftpLocalUserPayload(tenantId, publicKey);
  const response = await armRequest("PUT", url, payload);
  if (!response.ok) {
    const armError = await parseArmError(response);
    throw new AppError(armError.message, { status: 502, code: armError.code });
  }

  const homeDirectory = payload.properties.homeDirectory;
  const host = getSftpHost();
  return {
    username,
    host,
    homeDirectory,
    homeUri: buildSftpHomeUri(host, homeDirectory),
    container: env.azureStorageContainerName,
    prefix: `tenant=${tenantId}/`
  };
};

export const rotateSftpAuthorizedKey = async (
  tenantId: string,
  publicKey: string
): Promise<SftpProvisioningDetails> => {
  return provisionSftpLocalUser(tenantId, publicKey);
};

export const deleteSftpLocalUser = async (tenantId: string): Promise<void> => {
  const username = buildSftpUsername(tenantId);
  const url = buildLocalUserUrl(username);
  const response = await armRequest("DELETE", url);
  if (response.status === 404) return;
  if (!response.ok) {
    const armError = await parseArmError(response);
    throw new AppError(armError.message, { status: 502, code: armError.code });
  }
};
