import type { RequestHandler } from "express";
import type { RequestContext, RequestWithContext } from "../../../../shared/types/api";
import { AppError } from "../../../../shared/utils/errors";
import { auditLog } from "../../../../platform/gateway/src/core/audit/auditService";
import { validateFileType } from "../services/ingest/validate";
import { runIngestPipeline } from "../services/ingest/ingestPipeline";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

type IngestFromStorageBody = {
  tenant_id: string;
  storage_uri: string;
  source?: string;
  received_at?: string;
};

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 5 * 1024 * 1024);

const readFileFromStorageUri = async (storageUri: string) => {
  let url: URL;
  try {
    url = new URL(storageUri);
  } catch {
    throw new AppError("Invalid storage_uri", { status: 400, code: "BAD_STORAGE_URI" });
  }
  if (url.protocol !== "file:") {
    throw new AppError("Unsupported storage_uri protocol", { status: 400, code: "BAD_STORAGE_URI" });
  }
  const filePath = fileURLToPath(url);
  const stats = await fs.promises.stat(filePath);
  if (!stats.isFile()) {
    throw new AppError("Storage reference is not a file", { status: 400, code: "BAD_STORAGE_URI" });
  }
  if (stats.size > MAX_UPLOAD_BYTES) {
    throw new AppError("Upload too large", { status: 413, code: "FILE_TOO_LARGE" });
  }
  const fileBuffer = await fs.promises.readFile(filePath);
  const filename = path.basename(filePath);
  return { fileBuffer, filename };
};

export const ingestFromStorageHandler: RequestHandler = async (req, res) => {
  const ctx = (req as RequestWithContext).context;
  if (!ctx?.requestId || !ctx?.tenantId || !ctx?.userId || !ctx?.role) {
    const error = new AppError("Missing request context", { status: 400, code: "CTX_MISSING" });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  if (ctx.role !== "ADMIN" && ctx.role !== "DEALERADMIN" && ctx.role !== "DEVELOPER") {
    const error = new AppError("Admin role required", { status: 403, code: "ADMIN_ONLY" });
    return res.status(error.status ?? 403).json({ error: error.code, message: error.message });
  }

  const body = req.body as IngestFromStorageBody;
  const safeCtx = ctx as Required<RequestContext>;
  if (!body?.tenant_id || !body?.storage_uri) {
    const error = new AppError("tenant_id and storage_uri are required", {
      status: 400,
      code: "BAD_REQUEST"
    });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  if (body.tenant_id !== safeCtx.tenantId) {
    const error = new AppError("tenant_id mismatch", { status: 403, code: "TENANT_MISMATCH" });
    return res.status(error.status ?? 403).json({ error: error.code, message: error.message });
  }

  let fileBuffer: Buffer;
  let filename: string;
  try {
    const resolved = await readFileFromStorageUri(body.storage_uri);
    fileBuffer = resolved.fileBuffer;
    filename = resolved.filename;
  } catch (err) {
    const error = err instanceof AppError ? err : new AppError("Failed to read storage URI", { status: 400 });
    if (error.code === "FILE_TOO_LARGE") {
      await auditLog(ctx ?? {}, {
        action: "INGEST_FAILED",
        object_type: "repair_order",
        object_id: safeCtx.requestId,
        metadata: { reason: "file_too_large", stage: "validate" }
      });
    }
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  try {
    validateFileType(filename);
  } catch (err) {
    const error = err instanceof AppError ? err : new AppError("Invalid file type", { status: 400 });
    await auditLog(ctx ?? {}, {
      action: "INGEST_FAILED",
      object_type: "repair_order",
      object_id: safeCtx.requestId,
      metadata: { reason: "invalid_file_type", stage: "validate" }
    });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  try {
    await runIngestPipeline(safeCtx, {
      filename,
      fileBuffer,
      mimeType: "application/xml"
    });
  } catch (err) {
    const status =
      err instanceof AppError && err.code === "EMBED_FAIL"
        ? 503
        : err instanceof AppError && err.status
          ? err.status
          : 500;
    const code = err instanceof AppError && err.code ? err.code : "INGEST_ERROR";
    const msg =
      err instanceof AppError && err.code === "EMBED_FAIL"
        ? "Embedding unavailable"
        : err instanceof AppError
          ? err.message
          : "Ingestion failed";
    let stage = "unknown";
    if (err instanceof AppError && err.code === "PII_DETECTED") stage = "pii_detected";
    if (err instanceof AppError && err.code === "EMBED_FAIL") stage = "embed";

    await auditLog(ctx ?? {}, {
      action: "INGEST_FAILED",
      object_type: "repair_order",
      object_id: safeCtx?.requestId ?? undefined,
      metadata: {
        reason: msg.slice(0, 120),
        stage
      }
    });

    const includeDetail = process.env.NODE_ENV !== "production";
    const detail = includeDetail && err instanceof Error ? err.message : undefined;
    return res.status(status).json({ error: code, message: msg, detail });
  }

  return res.status(201).json({ status: "ok" });
};
