import { Router } from "express";
import type { RequestWithContext } from "../../../../../shared/types/api";
import { AppError } from "../../../../../shared/utils/errors";

export const authMeRouter = Router();

authMeRouter.get("/auth/me", async (req, res, next) => {
  const ctx = (req as RequestWithContext).context;
  if (!ctx?.userId || !ctx?.tenantId || !ctx?.role) {
    return next(new AppError("Not authenticated", { status: 401, code: "AUTH_REQUIRED" }));
  }
  return res.status(200).json({
    user_id: ctx.userId,
    tenant_id: ctx.tenantId,
    role: ctx.role,
    request_id: ctx.requestId
  });
});
