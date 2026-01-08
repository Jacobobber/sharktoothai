import type { RequestContext } from "../../../../../shared/types/api";
import { AppError } from "../../../../../shared/utils/errors";

export type PolicyDecision = {
  allow: boolean;
  reason?: string;
};

type Action = "PII_READ" | "PII_WRITE" | "BULK_DOWNLOAD" | "DEFAULT";

export const evaluatePolicy = async (
  ctx: RequestContext,
  action: Action,
  resourceTenantId?: string
): Promise<PolicyDecision> => {
  if (!ctx.tenantId) {
    throw new AppError("Tenant missing in policy context", { status: 403, code: "TENANT_POLICY_DENY" });
  }

  if (resourceTenantId && resourceTenantId !== ctx.tenantId) {
    return { allow: false, reason: "cross_tenant_denied" };
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
