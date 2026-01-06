import type { RequestHandler } from "express";
import type { RequestWithContext } from "../../../../../shared/types/api";
import { AppError } from "../../../../../shared/utils/errors";
import { auditLog } from "../../core/audit/auditService";
import { withRequestContext } from "../../db/pg";

export const tenantGuard: RequestHandler = async (req, res, next) => {
  if (req.path === "/health") return next();

  const ctx = (req as RequestWithContext).context;
  if (ctx?.role === "DEVELOPER") {
    return next();
  }
  if (!ctx?.tenantId) {
    void auditLog((ctx as any) ?? ({} as any), {
      action: "TENANT_DENY",
      object_type: "tenant",
      metadata: { reason: "missing_tenant" }
    });
    const error = new AppError("Tenant context missing", { status: 403, code: "TENANT_REQUIRED" });
    return res.status(error.status ?? 403).json({ error: error.code, message: error.message });
  }

  try {
    const tenant = await withRequestContext(ctx, async (client) => {
      const result = await client.query<{ is_active: boolean }>(
        `SELECT is_active FROM app.tenants WHERE tenant_id = $1`,
        [ctx.tenantId]
      );
      return result.rows[0];
    });
    if (!tenant || tenant.is_active === false) {
      void auditLog(ctx, {
        action: "TENANT_DENY",
        object_type: "tenant",
        metadata: { reason: "tenant_inactive" }
      });
      const error = new AppError("Tenant inactive", { status: 403, code: "TENANT_INACTIVE" });
      return res.status(error.status ?? 403).json({ error: error.code, message: error.message });
    }
  } catch (err) {
    return next(err);
  }

  next();
};
