"use strict";

const { BlobClient } = require("@azure/storage-blob");
const { DefaultAzureCredential } = require("@azure/identity");
const { createHash, randomUUID } = require("crypto");
const path = require("path");
const { Pool } = require("pg");
const { StringDecoder } = require("string_decoder");
const sax = require("sax");
const { fetch } = require("undici");

const REQUIRED_ENV = [
  "INTAKE_STORAGE_ACCOUNT",
  "INTAKE_CONTAINER",
  "INTAKE_ALLOWED_EXT",
  "INTAKE_MAX_BYTES",
  "INTAKE_WELLFORMED_XML",
  "INGEST_API_URL",
  "INGEST_AAD_AUDIENCE",
  "DATABASE_URL"
];

const requireEnv = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const loadConfig = () => {
  for (const name of REQUIRED_ENV) {
    requireEnv(name);
  }

  const maxBytes = Number.parseInt(process.env.INTAKE_MAX_BYTES, 10);
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new Error("INTAKE_MAX_BYTES must be a positive integer");
  }

  const xmlFlag = process.env.INTAKE_WELLFORMED_XML;
  if (xmlFlag !== "0" && xmlFlag !== "1") {
    throw new Error("INTAKE_WELLFORMED_XML must be 0 or 1");
  }

  const allowedExt = process.env.INTAKE_ALLOWED_EXT.replace(/^\./, "").toLowerCase();
  if (!allowedExt) {
    throw new Error("INTAKE_ALLOWED_EXT must be a non-empty extension");
  }

  return {
    intakeStorageAccount: process.env.INTAKE_STORAGE_ACCOUNT,
    intakeContainer: process.env.INTAKE_CONTAINER,
    intakeAllowedExt: allowedExt,
    intakeMaxBytes: maxBytes,
    intakeWellformedXml: xmlFlag === "1",
    ingestApiUrl: process.env.INGEST_API_URL,
    ingestAadAudience: process.env.INGEST_AAD_AUDIENCE,
    databaseUrl: process.env.DATABASE_URL
  };
};

const config = loadConfig();
const credential = new DefaultAzureCredential();
const pool = new Pool({ connectionString: config.databaseUrl });

const SOURCE = "ftp";
const STATUS = {
  RECEIVED: "RECEIVED",
  VALIDATED: "VALIDATED",
  INGESTING: "INGESTING",
  INGESTED: "INGESTED",
  FAILED: "FAILED",
  DUPLICATE: "DUPLICATE"
};

const parseTenantFromSubject = (subject, container) => {
  if (typeof subject !== "string") {
    return { ok: false };
  }
  const match = subject.match(/\/containers\/([^/]+)\/blobs\/(.+)/);
  if (!match) {
    return { ok: false };
  }
  if (match[1] !== container) {
    return { ok: false };
  }
  const decoded = decodeURIComponent(match[2]);
  const firstSegment = decoded.split("/")[0];
  if (!firstSegment || !firstSegment.startsWith("tenant=")) {
    return { ok: false };
  }
  const tenantId = firstSegment.slice("tenant=".length);
  if (!tenantId) {
    return { ok: false };
  }
  return { ok: true, tenantId };
};

const getBlobNameFromUrl = (blobUrl) => {
  const pathname = decodeURIComponent(new URL(blobUrl).pathname);
  return path.posix.basename(pathname);
};

const getBlobExtension = (blobName) => {
  if (!blobName) return "";
  return path.posix.extname(blobName).replace(/^\./, "").toLowerCase();
};

const downloadAndHash = async (blobClient, checkXml) => {
  const response = await blobClient.download(0);
  const stream = response.readableStreamBody;
  if (!stream) {
    throw new Error("Blob download stream unavailable");
  }

  const hash = createHash("sha256");
  let bytes = 0;
  let xmlWellFormed = true;
  let xmlError = null;
  let parser = null;
  let decoder = null;

  if (checkXml) {
    parser = sax.parser(true);
    decoder = new StringDecoder("utf8");
    parser.onerror = (err) => {
      xmlWellFormed = false;
      xmlError = err;
      parser.error = null;
    };
  }

  try {
    for await (const chunk of stream) {
      bytes += chunk.length;
      hash.update(chunk);
      if (checkXml && xmlWellFormed) {
        const text = decoder.write(chunk);
        if (text) {
          parser.write(text);
        }
      }
    }
    if (checkXml && xmlWellFormed) {
      const text = decoder.end();
      if (text) {
        parser.write(text);
      }
      parser.close();
    }
  } catch (err) {
    return {
      hash: hash.digest("hex"),
      bytes,
      xmlWellFormed: false,
      xmlError: xmlError ?? err,
      streamError: err
    };
  }

  return {
    hash: hash.digest("hex"),
    bytes,
    xmlWellFormed,
    xmlError,
    streamError: null
  };
};

const withTenantClient = async (tenantId, fn) => {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    return await fn(client);
  } finally {
    client.release();
  }
};

const insertReceived = async (client, input) => {
  const result = await client.query(
    `INSERT INTO app.ingest_files
       (id, tenant_id, storage_uri, content_hash, source, status, error_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id, content_hash) DO NOTHING`,
    [
      input.id,
      input.tenantId,
      input.storageUri,
      input.contentHash,
      SOURCE,
      STATUS.RECEIVED,
      null
    ]
  );
  return result.rowCount === 1;
};

const fetchExistingStatus = async (client, tenantId, contentHash) => {
  const result = await client.query(
    `SELECT status
       FROM app.ingest_files
      WHERE tenant_id = $1 AND content_hash = $2`,
    [tenantId, contentHash]
  );
  return result.rows[0]?.status ?? null;
};

const transitionStatus = async (client, tenantId, contentHash, fromStatus, toStatus, errorCode) => {
  const result = await client.query(
    `UPDATE app.ingest_files
        SET status = $1,
            error_code = $2
      WHERE tenant_id = $3
        AND content_hash = $4
        AND status = $5`,
    [toStatus, errorCode ?? null, tenantId, contentHash, fromStatus]
  );
  return result.rowCount === 1;
};

const markDuplicate = async (client, tenantId, contentHash) =>
  transitionStatus(client, tenantId, contentHash, STATUS.RECEIVED, STATUS.DUPLICATE, "DUPLICATE");

const callIngestApi = async (tenantId, storageUri) => {
  const scope = config.ingestAadAudience.endsWith("/.default")
    ? config.ingestAadAudience
    : `${config.ingestAadAudience}/.default`;
  const token = await credential.getToken(scope);
  if (!token?.token) {
    throw new Error("Failed to acquire Azure AD access token");
  }

  const response = await fetch(config.ingestApiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      tenant_id: tenantId,
      storage_uri: storageUri,
      source: SOURCE
    })
  });

  return response;
};

const processEvent = async (event, context) => {
  if (!event || event.eventType !== "Microsoft.Storage.BlobCreated") {
    return;
  }

  const eventId = event.id ?? "unknown";
  const storageUri = event.data?.url;
  if (!storageUri) {
    context.log("[intake] missing blob url", { event_id: eventId });
    return;
  }

  const tenantResult = parseTenantFromSubject(event.subject ?? "", config.intakeContainer);
  const tenantId = tenantResult.ok ? tenantResult.tenantId : "invalid";
  const invalidPath = !tenantResult.ok;

  const blobName = getBlobNameFromUrl(storageUri);
  const extension = getBlobExtension(blobName);
  const extensionValid = extension === config.intakeAllowedExt;

  let properties = null;
  let downloadResult = null;
  try {
    const blobClient = new BlobClient(storageUri, credential);
    properties = await blobClient.getProperties();
    downloadResult = await downloadAndHash(blobClient, config.intakeWellformedXml);
  } catch (err) {
    context.log("[intake] blob access failed", {
      event_id: eventId,
      storage_uri: storageUri,
      error: err instanceof Error ? err.message : err
    });
    return;
  }

  const contentHash = downloadResult.hash;
  const maxBytesExceeded =
    (properties?.contentLength ?? 0) > config.intakeMaxBytes || downloadResult.bytes > config.intakeMaxBytes;

  const insertResult = await withTenantClient(tenantId, async (client) => {
    const inserted = await insertReceived(client, {
      id: randomUUID(),
      tenantId,
      storageUri,
      contentHash
    });

    if (!inserted) {
      const existingStatus = await fetchExistingStatus(client, tenantId, contentHash);
      if (existingStatus === STATUS.RECEIVED) {
        await markDuplicate(client, tenantId, contentHash);
        return { duplicate: true, finalStatus: STATUS.DUPLICATE };
      }
      return { duplicate: true, finalStatus: existingStatus ?? STATUS.DUPLICATE };
    }

    return { duplicate: false, finalStatus: STATUS.RECEIVED };
  });

  if (insertResult.duplicate) {
    context.log("[intake] duplicate detected", {
      event_id: eventId,
      tenant_id: tenantId,
      storage_uri: storageUri,
      final_status: insertResult.finalStatus,
      error_code: "DUPLICATE"
    });
    return;
  }

  const logFinal = (finalStatus, errorCode) => {
    context.log("[intake] event processed", {
      event_id: eventId,
      tenant_id: tenantId,
      storage_uri: storageUri,
      final_status: finalStatus,
      error_code: errorCode ?? null
    });
  };

  if (invalidPath) {
    await withTenantClient(tenantId, (client) =>
      transitionStatus(client, tenantId, contentHash, STATUS.RECEIVED, STATUS.FAILED, "INVALID_PATH")
    );
    logFinal(STATUS.FAILED, "INVALID_PATH");
    return;
  }

  if (downloadResult.streamError) {
    await withTenantClient(tenantId, (client) =>
      transitionStatus(client, tenantId, contentHash, STATUS.RECEIVED, STATUS.FAILED, "DOWNLOAD_FAILED")
    );
    logFinal(STATUS.FAILED, "DOWNLOAD_FAILED");
    throw downloadResult.streamError;
  }

  if (!extensionValid || maxBytesExceeded) {
    const errorCode = !extensionValid ? "INVALID_EXTENSION" : "FILE_TOO_LARGE";
    await withTenantClient(tenantId, (client) =>
      transitionStatus(client, tenantId, contentHash, STATUS.RECEIVED, STATUS.FAILED, errorCode)
    );
    logFinal(STATUS.FAILED, errorCode);
    return;
  }

  const validated = await withTenantClient(tenantId, (client) =>
    transitionStatus(client, tenantId, contentHash, STATUS.RECEIVED, STATUS.VALIDATED, null)
  );
  if (!validated) {
    logFinal(STATUS.FAILED, "INVALID_STATE");
    return;
  }

  if (config.intakeWellformedXml && !downloadResult.xmlWellFormed) {
    await withTenantClient(tenantId, (client) =>
      transitionStatus(client, tenantId, contentHash, STATUS.VALIDATED, STATUS.FAILED, "MALFORMED_XML")
    );
    logFinal(STATUS.FAILED, "MALFORMED_XML");
    return;
  }

  const ingesting = await withTenantClient(tenantId, (client) =>
    transitionStatus(client, tenantId, contentHash, STATUS.VALIDATED, STATUS.INGESTING, null)
  );
  if (!ingesting) {
    logFinal(STATUS.FAILED, "INVALID_STATE");
    return;
  }

  let ingestResponse = null;
  try {
    ingestResponse = await callIngestApi(tenantId, storageUri);
  } catch (err) {
    await withTenantClient(tenantId, (client) =>
      transitionStatus(client, tenantId, contentHash, STATUS.INGESTING, STATUS.FAILED, "INGEST_ERROR")
    );
    logFinal(STATUS.FAILED, "INGEST_ERROR");
    throw err;
  }

  if (!ingestResponse.ok) {
    const errorCode = `INGEST_HTTP_${ingestResponse.status}`;
    await withTenantClient(tenantId, (client) =>
      transitionStatus(client, tenantId, contentHash, STATUS.INGESTING, STATUS.FAILED, errorCode)
    );
    logFinal(STATUS.FAILED, errorCode);
    return;
  }

  await withTenantClient(tenantId, (client) =>
    transitionStatus(client, tenantId, contentHash, STATUS.INGESTING, STATUS.INGESTED, null)
  );
  logFinal(STATUS.INGESTED, null);
};

module.exports = async function (context, event) {
  const events = Array.isArray(event) ? event : [event];
  for (const item of events) {
    await processEvent(item, context);
  }
};
