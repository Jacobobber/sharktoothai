import { isValidSshPublicKey } from "../../shared/utils/ssh";

const assert = (condition: boolean, message: string) => {
  if (!condition) {
    console.error(`Test failed: ${message}`);
    process.exit(1);
  }
};

const seedEnv = () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://user:pass@localhost:5432/db";
  process.env.AZURE_SUBSCRIPTION_ID = process.env.AZURE_SUBSCRIPTION_ID ?? "sub-id";
  process.env.AZURE_RESOURCE_GROUP = process.env.AZURE_RESOURCE_GROUP ?? "rg";
  process.env.AZURE_STORAGE_ACCOUNT_NAME = process.env.AZURE_STORAGE_ACCOUNT_NAME ?? "storageaccount";
  process.env.AZURE_STORAGE_CONTAINER_NAME = process.env.AZURE_STORAGE_CONTAINER_NAME ?? "ro-ingest-raw";
  process.env.AZURE_ARM_API_VERSION = process.env.AZURE_ARM_API_VERSION ?? "2023-01-01";
  process.env.AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT ?? "https://example.openai.azure.com";
  process.env.AZURE_OPENAI_API_KEY = process.env.AZURE_OPENAI_API_KEY ?? "test-key";
  process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT = process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT ?? "embeddings";
  process.env.AZURE_OPENAI_API_VERSION = process.env.AZURE_OPENAI_API_VERSION ?? "2024-02-15-preview";
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "jwt-secret";
  process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? "1h";
  process.env.DEV_AUTH_TOKEN_ADMIN = process.env.DEV_AUTH_TOKEN_ADMIN ?? "dev-token";
  process.env.DEV_USER_ID_ADMIN = process.env.DEV_USER_ID_ADMIN ?? "00000000-0000-0000-0000-000000000001";
  process.env.DEV_TENANT_ID_ADMIN = process.env.DEV_TENANT_ID_ADMIN ?? "00000000-0000-0000-0000-000000000002";
};

seedEnv();

const validKey =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMdmw1p6bFQ0zvXKXb9cL1yUeQ3Zx8ioQbA1aC2lV5gf test@example";
const invalidKey = "ssh-ed25519 invalid";

assert(isValidSshPublicKey(validKey), "valid SSH key should pass");
assert(!isValidSshPublicKey(invalidKey), "invalid SSH key should fail");

const { buildSftpLocalUserPayload } = require("../../platform/gateway/src/core/azure/storageSftp");
const { buildSftpSuccessUpdate, buildSftpFailureUpdate } = require(
  "../../platform/gateway/src/core/tenant/sftpTenant"
);

const payload = buildSftpLocalUserPayload("tenant-123", validKey);
assert(payload.properties.hasSshKey === true, "SFTP payload must enforce SSH key auth");
assert(payload.properties.hasPassword === false, "SFTP payload must disable password auth");
assert(payload.properties.hasSharedKey === false, "SFTP payload must disable shared key auth");
assert(payload.properties.permissionScopes[0].permissions === "w", "SFTP payload must be write-only");
assert(payload.properties.permissionScopes[0].service === "blob", "SFTP payload must target blob service");
assert(
  payload.properties.permissionScopes[0].resourceName === "ro-ingest-raw",
  "SFTP payload must target ingest container"
);
assert(
  payload.properties.homeDirectory === "ro-ingest-raw/tenant=tenant-123/",
  "SFTP home directory must be tenant scoped"
);

const success = buildSftpSuccessUpdate({
  username: "tenant_tenant-123",
  host: "example.blob.core.windows.net",
  homeDirectory: "ro-ingest-raw/tenant=tenant-123/",
  homeUri: "sftp://example.blob.core.windows.net/ro-ingest-raw/tenant=tenant-123/",
  container: "ro-ingest-raw",
  prefix: "tenant=tenant-123/"
});
assert(success.sftp_enabled === true, "success update must enable SFTP");
assert(success.sftp_username === "tenant_tenant-123", "success update must include username");
assert(success.sftp_home_uri.includes("sftp://"), "success update must include SFTP URI");

const failure = buildSftpFailureUpdate("ARM_FAIL");
assert(failure.sftp_enabled === false, "failure update must disable SFTP");
assert(failure.sftp_last_error_code === "ARM_FAIL", "failure update must capture error code");

console.log("SFTP provisioning unit tests passed.");
