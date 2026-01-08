import type { RequestHandler } from "express";
import type { RequestWithContext } from "../../../../../shared/types/api";
import { AppError } from "../../../../../shared/utils/errors";
import { verifyToken } from "../../core/auth/tokens";
import { auditLog } from "../../core/audit/auditService";
import { loadEnv } from "../../config/env";

// Auth boundary: derives context solely from verified JWT; dev bypass allowed only in development.
const env = loadEnv();

export const authContext: RequestHandler = async (req, res, next) => {
  if (req.path === "/health") return next();
  const hasImpersonationHeader =
    Boolean(req.header("x-tenant-id")) ||
    Boolean(req.header("x-scope-tenant-id")) ||
    Boolean(req.header("x-scope-group-id"));
  if (process.env.NODE_ENV === "production" && hasImpersonationHeader) {
    const error = new AppError("Header-based tenant scoping is not allowed", {
      status: 400,
      code: "TENANT_SCOPE_FORBIDDEN"
    });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  const ctxReq = req as RequestWithContext;
  const requestId = ctxReq.context?.requestId;
  const authHeader = req.header("authorization");
  const bearerToken =
    authHeader && authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : undefined;
  const cookieToken = req.headers.cookie
    ? req.headers.cookie
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("auth_token="))
        ?.split("=")[1]
    : undefined;
  const token = bearerToken ?? cookieToken;
  const wantsAppLoginRedirect =
    req.method === "GET" && (req.path.startsWith("/admin") || req.path.startsWith("/app"));

  if (!token) {
    if (wantsAppLoginRedirect) {
      const redirectTarget = req.path.startsWith("/admin") ? "/admin" : "/app";
      return res.redirect(302, `/login?redirect=${encodeURIComponent(redirectTarget)}`);
    }
    if (env.devAuthBypass && process.env.NODE_ENV === "development") {
      ctxReq.context = {
        ...(ctxReq.context ?? {}),
        requestId: requestId ?? "dev-request",
        userId: env.devUserIdAdmin,
        tenantId: env.devTenantIdAdmin,
        role: "ADMIN"
      };
      return next();
    }
    void auditLog(ctxReq.context ?? ({} as any), {
      action: "AUTH_DENY",
      object_type: "auth",
      metadata: { reason: "missing_token" }
    });
    const error = new AppError("Missing auth token", { status: 401, code: "AUTH_REQUIRED" });
    return res.status(error.status ?? 401).json({ error: error.code, message: error.message });
  }

  try {
    const verified = await verifyToken(token);
    if (!requestId) {
      const error = new AppError("Missing request id", { status: 400, code: "REQUEST_ID_MISSING" });
      return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
    }

    ctxReq.context = {
      ...(ctxReq.context ?? {}),
      requestId,
      userId: verified.userId,
      tenantId: verified.tenantId,
      role: verified.role
    };
  } catch (err) {
    const error =
      err instanceof AppError
        ? err
        : new AppError("Invalid auth token", { status: 401, code: "AUTH_INVALID" });
    if (wantsAppLoginRedirect) {
      const redirectTarget = req.path.startsWith("/admin") ? "/admin" : "/app";
      return res.redirect(302, `/login?redirect=${encodeURIComponent(redirectTarget)}`);
    }
    void auditLog(ctxReq.context ?? ({} as any), {
      action: "AUTH_DENY",
      object_type: "auth",
      metadata: { reason: "invalid_token" }
    });
    return res.status(error.status ?? 401).json({ error: error.code, message: error.message });
  }

  next();
};
