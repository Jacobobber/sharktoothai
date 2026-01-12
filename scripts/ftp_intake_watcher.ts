import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { createHash, randomUUID } from "crypto";
import { Pool } from "pg";

dotenv.config();

const INCOMING_DIR = process.env.FTP_INCOMING_DIR ?? "/ftp/incoming";
const RAW_INTAKE_DIR = process.env.RAW_INTAKE_DIR ?? "/data/raw_intake";
const SOURCE = "ftp";
const MAX_FILE_BYTES = Number(process.env.FTP_MAX_UPLOAD_BYTES ?? 20 * 1024 * 1024);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Intake is custody-only: no XML parsing or ingestion occurs here by design.
// Minimal file safety checks are permitted before handoff.

const isXmlFile = (filePath: string) => filePath.toLowerCase().endsWith(".xml");
const isTempFile = (filePath: string) =>
  /\.(tmp|partial|swp|swx|~)$/.test(filePath.toLowerCase()) || path.basename(filePath).startsWith(".");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isStableFile = async (filePath: string) => {
  const first = await fs.promises.stat(filePath);
  await sleep(500);
  const second = await fs.promises.stat(filePath);
  return first.size === second.size && first.mtimeMs === second.mtimeMs;
};

const sha256File = async (filePath: string) =>
  new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });

const parseIncomingPath = (filePath: string) => {
  const relative = path.relative(INCOMING_DIR, filePath);
  const parts = relative.split(path.sep);
  if (parts.length < 2) return null;
  const filename = parts[parts.length - 1];
  const dateIndex = parts.findIndex((part) => /^\d{4}$/.test(part));
  if (dateIndex === -1 || dateIndex + 2 >= parts.length) {
    return { tenantId: parts[0], date: new Date().toISOString().slice(0, 10), filename };
  }
  const year = parts[dateIndex];
  const month = parts[dateIndex + 1];
  const day = parts[dateIndex + 2];
  const tenantIndex = dateIndex >= 1 ? dateIndex - 1 : 0;
  const tenantId = parts[tenantIndex];
  if (!tenantId) return null;
  return { tenantId, date: `${year}-${month}-${day}`, filename };
};

const copyImmutable = async (sourcePath: string, destDir: string, destFilename: string) => {
  await fs.promises.mkdir(destDir, { recursive: true });
  const destFile = path.join(destDir, destFilename);
  await fs.promises.copyFile(sourcePath, destFile, fs.constants.COPYFILE_EXCL);
  return destFile;
};

const writeMetadata = async (destDir: string, data: Record<string, unknown>) => {
  const metadataPath = path.join(destDir, "metadata.json");
  const checksumPath = path.join(destDir, "checksum.sha256");
  await fs.promises.writeFile(metadataPath, JSON.stringify(data, null, 2), { flag: "wx" });
  await fs.promises.writeFile(checksumPath, `${data.checksum}\n`, { flag: "wx" });
};

const insertIngestFile = async (input: {
  id: string;
  tenantId: string;
  checksum: string;
  storageUri: string;
  receivedAt: string;
  status: string;
  errorCode?: string | null;
}) => {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [input.tenantId]);
    await client.query(
      `INSERT INTO app.ingest_files
       (id, tenant_id, storage_uri, content_hash, source, status, error_code, received_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [input.id, input.tenantId, input.storageUri, input.checksum, SOURCE, input.status, input.errorCode, input.receivedAt]
    );
  } finally {
    client.release();
  }
};

const updateIngestStatus = async (
  tenantId: string,
  contentHash: string,
  status: string,
  errorCode?: string | null
) => {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query(
      `UPDATE app.ingest_files
       SET status = $1,
           error_code = $2
       WHERE tenant_id = $3 AND content_hash = $4`,
      [status, errorCode ?? null, tenantId, contentHash]
    );
  } finally {
    client.release();
  }
};

const findExistingIngest = async (tenantId: string, contentHash: string) => {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await client.query<{ id: string; status: string }>(
      `SELECT id, status
       FROM app.ingest_files
       WHERE tenant_id = $1 AND content_hash = $2`,
      [tenantId, contentHash]
    );
    return result.rows[0] ?? null;
  } finally {
    client.release();
  }
};

const validateFile = async (filePath: string) => {
  const stats = await fs.promises.stat(filePath);
  if (stats.size > MAX_FILE_BYTES) {
    return { ok: false, errorCode: "FILE_TOO_LARGE" };
  }
  if (!isXmlFile(filePath)) {
    return { ok: false, errorCode: "INVALID_EXTENSION" };
  }
  return { ok: true, errorCode: null };
};

const invokeIngest = async (_input: {
  tenantId: string;
  storageUri: string;
  source: string;
  receivedAt: string;
}) => {
  // Transport adapter only: ingest invocation remains unchanged and is wired elsewhere.
  return;
};

const processed = new Set<string>();

const handleFile = async (filePath: string) => {
  if (processed.has(filePath)) return;
  if (!isXmlFile(filePath) || isTempFile(filePath)) return;

  const info = parseIncomingPath(filePath);
  if (!info) {
    console.warn("[ftp-intake] skipped unrecognized path", { filePath });
    return;
  }

  if (!(await isStableFile(filePath))) return;

  const batchId = randomUUID();
  const receivedAt = new Date().toISOString();
  const destDir = path.join(RAW_INTAKE_DIR, `tenant=${info.tenantId}`, `date=${info.date}`, "source=ftp");
  const destFilename = `${batchId}.xml`;
  const storageUri = `file://${path.join(destDir, destFilename)}`;

  console.log("[ftp-intake] receipt detected", {
    batch_id: batchId,
    tenant_id: info.tenantId,
    filename: info.filename
  });

  const checksum = await sha256File(filePath);
  const existing = await findExistingIngest(info.tenantId, checksum);
  if (existing) {
    await updateIngestStatus(info.tenantId, checksum, "DUPLICATE", "DUPLICATE");
    console.log("[ftp-intake] duplicate detected", {
      batch_id: existing.id,
      tenant_id: info.tenantId,
      checksum
    });
    return;
  }

  try {
    await copyImmutable(filePath, destDir, destFilename);
    await writeMetadata(destDir, {
      batch_id: batchId,
      tenant_id: info.tenantId,
      filename: info.filename,
      checksum,
      received_at: receivedAt,
      source: SOURCE,
      storage_uri: storageUri,
      note: "Raw custody only. No validation, parsing, or ingestion occurs at intake time."
    });
  } catch (err) {
    console.error("[ftp-intake] raw copy failed", {
      batch_id: batchId,
      tenant_id: info.tenantId,
      error: err instanceof Error ? err.message : err
    });
    return;
  }

  try {
    await insertIngestFile({
      id: batchId,
      tenantId: info.tenantId,
      checksum,
      storageUri,
      receivedAt,
      status: "RECEIVED"
    });
  } catch (err) {
    console.error("[ftp-intake] registry insert failed", {
      batch_id: batchId,
      tenant_id: info.tenantId,
      error: err instanceof Error ? err.message : err
    });
    return;
  }

  const validation = await validateFile(filePath);
  if (!validation.ok) {
    await updateIngestStatus(info.tenantId, checksum, "FAILED", validation.errorCode);
    console.error("[ftp-intake] validation failed", {
      batch_id: batchId,
      tenant_id: info.tenantId,
      error_code: validation.errorCode
    });
    return;
  }

  await updateIngestStatus(info.tenantId, checksum, "VALIDATED");

  processed.add(filePath);
  console.log("[ftp-intake] intake batch recorded", {
    batch_id: batchId,
    tenant_id: info.tenantId,
    checksum
  });
};

const scanIncoming = async (dir: string) => {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await scanIncoming(fullPath);
    } else if (entry.isFile()) {
      await handleFile(fullPath);
    }
  }
};

const main = async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL not configured");
  }
  await fs.promises.mkdir(INCOMING_DIR, { recursive: true });
  await fs.promises.mkdir(RAW_INTAKE_DIR, { recursive: true });

  console.log("[ftp-intake] watcher started", { incoming: INCOMING_DIR, raw: RAW_INTAKE_DIR });

  await scanIncoming(INCOMING_DIR);
  setInterval(() => {
    void scanIncoming(INCOMING_DIR).catch((err) => {
      console.error("[ftp-intake] scan failed", err instanceof Error ? err.message : err);
    });
  }, 2000);
};

main().catch((err) => {
  console.error("[ftp-intake] fatal error", err instanceof Error ? err.message : err);
  process.exit(1);
});
