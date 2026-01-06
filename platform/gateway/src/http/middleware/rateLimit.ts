import type { RequestHandler } from "express";
import type { RequestWithContext } from "../../../../../shared/types/api";
import { AppError } from "../../../../../shared/utils/errors";
import { auditLog } from "../../core/audit/auditService";

type Bucket = {
  count: number;
  windowStart: number;
};

import { loadEnv } from "../../config/env";

const envCfg = loadEnv();
const WINDOW_SEC = envCfg.rateLimitWindowSec;
const MAX_REQUESTS = envCfg.rateLimitMax;
const buckets = new Map<string, Bucket>();

const nowSec = () => Math.floor(Date.now() / 1000);

export const rateLimit: RequestHandler = async (req, res, next) => {
  if (req.path === "/health") return next();

  const ctx = (req as RequestWithContext).context;
  if (!ctx?.userId || !ctx?.requestId) {
    const error = new AppError("Missing context for rate limit", { status: 400, code: "CTX_MISSING" });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }
  if (!ctx.tenantId && ctx.role !== "DEVELOPER") {
    const error = new AppError("Missing context for rate limit", { status: 400, code: "CTX_MISSING" });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  const key = ctx.tenantId ? `${ctx.tenantId}:${ctx.userId}` : `dev:${ctx.userId}`;
  const now = nowSec();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart >= WINDOW_SEC) {
    buckets.set(key, { count: 1, windowStart: now });
    return next();
  }

  if (bucket.count < MAX_REQUESTS) {
    bucket.count += 1;
    return next();
  }

  // Rate limit exceeded
  await auditLog(ctx, {
    action: "RATE_LIMIT",
    object_type: "request",
    object_id: key
  });

  return res.status(429).json({
    error: "RATE_LIMITED",
    message: "Too many requests",
    requestId: ctx.requestId
  });
};
