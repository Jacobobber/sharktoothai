import type { ErrorRequestHandler } from "express";
import { AppError } from "../../../../../shared/utils/errors";
import { logger } from "../../../../../shared/utils/logger";

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const status =
    err instanceof AppError && err.status
      ? err.status
      : typeof err?.status === "number"
        ? err.status
        : typeof err?.statusCode === "number"
          ? err.statusCode
          : 500;
  const code =
    err instanceof AppError && err.code
      ? err.code
      : err?.type === "entity.too.large"
        ? "FILE_TOO_LARGE"
        : "INTERNAL_ERROR";
  const message =
    code === "FILE_TOO_LARGE"
      ? "Upload too large"
      : code === "INTERNAL_ERROR"
        ? "Internal server error"
        : err.message ?? "Request failed";
  const requestId = (req as any)?.context?.requestId;

  if (code === "INTERNAL_ERROR" || status >= 500) {
    logger.error("Unhandled request error", {
      requestId,
      status,
      code,
      message: err instanceof Error ? err.message : String(err)
    });
  }

  // Centralized error response to avoid leaking internals (e.g., DB errors, stack traces).
  res.status(status).json({ error: code, message, requestId });
};
