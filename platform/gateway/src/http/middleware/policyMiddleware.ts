import type { RequestHandler } from "express";
import type { RequestWithContext } from "../../../../../shared/types/api";
import { AppError } from "../../../../../shared/utils/errors";
import { auditLog } from "../../core/audit/auditService";

type PolicyAction = "PII_READ" | "PII_WRITE" | "BULK_DOWNLOAD" | "DEFAULT";

const actionForPath = (method: string, path: string): PolicyAction => {
  if (path.includes("/pii/") && (method === "GET")) return "PII_READ";
  if (path.includes("/pii/") && (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE"))
    return "PII_WRITE";
  if (path.includes("/documents/") && path.includes("/download")) return "BULK_DOWNLOAD";
  return "DEFAULT";
};

const evaluatePolicy = (ctx: NonNullable<RequestWithContext["context"]>, action: PolicyAction) => {
  if (!ctx.tenantId) {
    throw new AppError("Tenant missing in policy context", { status: 403, code: "TENANT_POLICY_DENY" });
  }

  if (action === "PII_READ") {
    return { allow: false, reason: "pii_read_disabled" };
  }

  if (action === "PII_WRITE") {
    if (ctx.role !== "ADMIN" && ctx.role !== "DEALERADMIN" && ctx.role !== "DEVELOPER") {
      return { allow: false, reason: "pii_role_denied" };
    }
  }

  if (
    action === "BULK_DOWNLOAD" &&
    ctx.role !== "ADMIN" &&
    ctx.role !== "DEALERADMIN" &&
    ctx.role !== "DEVELOPER"
  ) {
    return { allow: false, reason: "bulk_admin_only" };
  }

  return { allow: true };
};

export const policyMiddleware: RequestHandler = async (req, res, next) => {
  if (req.path === "/health") return next();

  const ctx = (req as RequestWithContext).context;
  if (!ctx?.tenantId) {
    const error = new AppError("Tenant missing for policy", { status: 403, code: "TENANT_POLICY_DENY" });
    return res.status(error.status ?? 403).json({ error: error.code, message: error.message });
  }

  const action = actionForPath(req.method, req.path);
  const decision = evaluatePolicy(ctx, action);
  if (!decision.allow) {
    await auditLog(ctx, {
      action: "POLICY_DENY",
      object_type: "policy",
      metadata: { reason: decision.reason ?? "denied", path: req.path, method: req.method }
    });
    const error = new AppError("Policy denied", { status: 403, code: "POLICY_DENY" });
    return res.status(error.status ?? 403).json({ error: error.code, message: error.message });
  }

  next();
};
