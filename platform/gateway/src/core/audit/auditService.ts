import { randomUUID } from "crypto";
import type { RequestContext } from "../../../../../shared/types/api";
import { logger } from "../../../../../shared/utils/logger";
import { withRequestContext } from "../../db/pg";

export type AuditEvent = {
  action: string;
  object_type: string;
  object_id?: string;
  metadata?: Record<string, unknown>;
};

const sanitizeMetadata = (metadata?: Record<string, unknown>) => {
  if (!metadata) return null;
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string") {
      safe[key] = value.slice(0, 256); // truncate to avoid raw text/PII exposure
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      safe[key] = value;
      continue;
    }
    // Drop objects/arrays/buffers to avoid accidental payload logging.
  }
  return Object.keys(safe).length ? safe : null;
};

const hasRlsContext = (ctx?: RequestContext): ctx is Required<RequestContext> => {
  return Boolean(ctx?.tenantId && ctx?.userId && ctx?.requestId && ctx?.role);
};

export const auditLog = async (ctx: RequestContext, event: AuditEvent) => {
  // Pre-auth or malformed context — skip audit silently
  if (!hasRlsContext(ctx)) {
    return;
  }

  const safeCtx = ctx;
  const metadata = sanitizeMetadata(event.metadata);

  try {
    await withRequestContext(safeCtx, async (client) => {
      await client.query(
        `INSERT INTO app.audit_logs
          (tenant_id, user_id, request_id, action, object_type, object_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          safeCtx.tenantId,
          safeCtx.userId,
          safeCtx.requestId,
          event.action,
          event.object_type,
          event.object_id ?? null,
          metadata
        ]
      );
    });
  } catch (err) {
    logger.error("Failed to write audit log", err);
  }
};
