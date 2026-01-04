import type { RequestHandler } from "express";
import type { RequestWithContext } from "../../../../../shared/types/api";
import type { Role } from "../../../../../shared/types/domain";
import { AppError } from "../../../../../shared/utils/errors";
import { auditLog } from "../../core/audit/auditService";

type PermissionRule = {
  match: (method: string, path: string) => boolean;
  roles: Role[];
};

const rules: PermissionRule[] = [
  { match: (m, p) => m === "GET" && p.startsWith("/admin"), roles: ["ADMIN", "DEALERADMIN", "DEVELOPER"] },
  { match: (m, p) => m === "GET" && p === "/audit", roles: ["ADMIN", "DEALERADMIN", "DEVELOPER"] },
  { match: (_m, p) => p.startsWith("/admin/api"), roles: ["ADMIN", "DEALERADMIN", "DEVELOPER"] },
  { match: (m, p) => m === "POST" && p === "/workloads/ro/ingest", roles: ["ADMIN", "DEALERADMIN", "DEVELOPER"] },
  { match: (m, p) => m === "POST" && p === "/workloads/ro/search", roles: ["USER", "ADMIN", "DEALERADMIN", "DEVELOPER"] },
  { match: (m, p) => m === "POST" && p === "/workloads/ro/answer", roles: ["USER", "ADMIN", "DEALERADMIN", "DEVELOPER"] },
  { match: (m, p) => m === "GET" && p.startsWith("/workloads/ro/ro/"), roles: ["USER", "ADMIN", "DEALERADMIN", "DEVELOPER"] },
  { match: (_m, _p) => true, roles: ["USER", "ADMIN", "DEALERADMIN", "DEVELOPER"] } // default guard for other protected routes
];

const isAllowed = (method: string, path: string, role: Role) => {
  const rule = rules.find((r) => r.match(method, path));
  if (!rule) return false;
  return rule.roles.includes(role);
};

export const rbacGuard: RequestHandler = (req, res, next) => {
  if (req.path === "/health") return next();

  const ctx = (req as RequestWithContext).context;
  if (!ctx?.role) {
    void auditLog((ctx as any) ?? ({} as any), {
      action: "RBAC_DENY",
      object_type: "rbac",
      metadata: { reason: "missing_role" }
    });
    const error = new AppError("Role required", { status: 403, code: "ROLE_REQUIRED" });
    return res.status(error.status ?? 403).json({ error: error.code, message: error.message });
  }

  const allowed = isAllowed(req.method, req.path, ctx.role);
  if (!allowed) {
    if (req.method === "GET" && req.path.startsWith("/admin")) {
      return res.redirect(302, "/login?redirect=/admin");
    }
    void auditLog(ctx, {
      action: "RBAC_DENY",
      object_type: "rbac",
      metadata: { reason: "forbidden", method: req.method, path: req.path }
    });
    const error = new AppError("Insufficient role", { status: 403, code: "ROLE_FORBIDDEN" });
    return res.status(error.status ?? 403).json({ error: error.code, message: error.message });
  }

  next();
};
