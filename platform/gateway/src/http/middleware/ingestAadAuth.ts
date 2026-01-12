import type { RequestHandler } from "express";
import type { RequestWithContext } from "../../../../../shared/types/api";
import { AppError } from "../../../../../shared/utils/errors";
import { logger } from "../../../../../shared/utils/logger";
import { auditLog } from "../../core/audit/auditService";
import { loadEnv } from "../../config/env";
import { verifyIngestAadToken } from "../../core/auth/ingestAad";

const env = loadEnv();
let auditFn = auditLog;

export const setIngestAuthAuditLogger = (loggerFn: typeof auditLog) => {
  auditFn = loggerFn;
};

const parseBearerToken = (header: string | undefined) => {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return undefined;
  return trimmed.slice(7).trim();
};

export const ingestAadAuth: RequestHandler = async (req, res, next) => {
  const token = parseBearerToken(req.header("authorization"));
  if (!token) {
    logger.warn("Ingest auth missing bearer token", { path: req.path });
    const error = new AppError("Missing auth token", { status: 401, code: "INGEST_AUTH_REQUIRED" });
    return res.status(error.status ?? 401).json({ error: error.code, message: error.message });
  }

  let claims: { oid: string; tid: string; aud: string | string[] };
  try {
    claims = await verifyIngestAadToken(token, env.ingestAadAudience);
  } catch (err) {
    logger.warn("Ingest auth token verification failed", { path: req.path });
    const error = err instanceof AppError ? err : new AppError("Invalid auth token", { status: 401 });
    return res.status(error.status ?? 401).json({ error: error.code ?? "INGEST_AUTH_INVALID", message: error.message });
  }

  const allowed = env.ingestAllowedCallerObjectIds.includes(claims.oid.toLowerCase());
  const body = req.body as { tenant_id?: string } | undefined;
  const tenantId = typeof body?.tenant_id === "string" ? body?.tenant_id : undefined;
  if (!tenantId) {
    const error = new AppError("tenant_id and storage_uri are required", {
      status: 400,
      code: "BAD_REQUEST"
    });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  const ctxReq = req as RequestWithContext;
  ctxReq.context = {
    ...(ctxReq.context ?? {}),
    requestId: ctxReq.context?.requestId ?? "ingest-request",
    userId: claims.oid,
    tenantId,
    role: "ADMIN"
  };

  if (!allowed) {
    await auditFn(ctxReq.context, {
      action: "INGEST_AUTH_DENY",
      object_type: "ingest",
      metadata: {
        reason: "caller_not_allowlisted",
        caller_oid: claims.oid,
        caller_tid: claims.tid,
        audience: Array.isArray(claims.aud) ? claims.aud.join(",") : claims.aud
      }
    });
    const error = new AppError("Caller not allowlisted", { status: 403, code: "INGEST_CALLER_FORBIDDEN" });
    return res.status(error.status ?? 403).json({ error: error.code, message: error.message });
  }

  await auditFn(ctxReq.context, {
    action: "INGEST_AUTH_ALLOW",
    object_type: "ingest",
    metadata: {
      caller_oid: claims.oid,
      caller_tid: claims.tid,
      audience: Array.isArray(claims.aud) ? claims.aud.join(",") : claims.aud
    }
  });

  next();
};
