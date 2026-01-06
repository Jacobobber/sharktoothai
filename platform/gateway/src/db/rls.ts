import type { RequestHandler } from "express";
import type { RequestWithContext } from "../../../../shared/types/api";
import { AppError } from "../../../../shared/utils/errors";

export const rlsContext: RequestHandler = (req, res, next) => {
  if (req.path === "/health") return next();

  const ctx = (req as RequestWithContext).context;
  if (!ctx?.userId || !ctx?.role || !ctx?.requestId) {
    const error = new AppError("RLS context incomplete", { status: 400, code: "RLS_CONTEXT_MISSING" });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }
  if (!ctx?.tenantId && ctx.role !== "DEVELOPER") {
    const error = new AppError("RLS context incomplete", { status: 400, code: "RLS_CONTEXT_MISSING" });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  // Database session binding occurs in db/pg.ts when a client is acquired.
  next();
};
