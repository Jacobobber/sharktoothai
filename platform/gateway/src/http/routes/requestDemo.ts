import { Router } from "express";
import { sendDemoRequestEmail } from "../../core/notifications/demoRequestEmail";
import type { RequestWithContext } from "../../../../../shared/types/api";
import { logger } from "../../../../../shared/utils/logger";

export const requestDemoRouter = Router();

type Bucket = {
  count: number;
  windowStart: number;
};

const asInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const RATE_LIMIT_WINDOW_SEC = asInt(process.env.DEMO_RATE_LIMIT_WINDOW_SEC, 60);
const RATE_LIMIT_MAX = asInt(process.env.DEMO_RATE_LIMIT_MAX, 10);
const rateBuckets = new Map<string, Bucket>();

const nowSec = () => Math.floor(Date.now() / 1000);

const parseCookies = (cookieHeader: string | undefined) => {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [key, ...rest] = part.trim().split("=");
    if (!key) continue;
    cookies[key] = decodeURIComponent(rest.join("="));
  }
  return cookies;
};

const sanitizeText = (value: unknown) => {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
};

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const rateLimitDemo = (ip: string) => {
  const now = nowSec();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_SEC) {
    rateBuckets.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (bucket.count < RATE_LIMIT_MAX) {
    bucket.count += 1;
    return true;
  }
  return false;
};

requestDemoRouter.post("/api/request-demo", async (req, res) => {
  if (!req.is("application/json")) {
    return res.status(415).json({ error: "UNSUPPORTED_MEDIA_TYPE", message: "JSON required" });
  }

  const csrfHeader = req.header("x-csrf-token") ?? "";
  const cookies = parseCookies(req.headers.cookie);
  if (!csrfHeader || !cookies.st_csrf || csrfHeader !== cookies.st_csrf) {
    return res.status(403).json({ error: "FORBIDDEN", message: "Request forbidden" });
  }

  const ip = req.ip || "unknown";
  if (!rateLimitDemo(ip)) {
    return res.status(429).json({ error: "RATE_LIMITED", message: "Too many requests" });
  }

  const body = req.body ?? {};
  const fullName = sanitizeText(body.full_name);
  const workEmail = sanitizeText(body.work_email).toLowerCase();
  const company = sanitizeText(body.company);
  const message = sanitizeText(body.message);

  if (!fullName || !workEmail || !company) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "Invalid input" });
  }

  if (!isValidEmail(workEmail)) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "Invalid input" });
  }

  try {
    const requestId = (req as RequestWithContext).context?.requestId;
    await sendDemoRequestEmail({
      fullName,
      workEmail,
      company,
      message: message || undefined,
      requestId
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    logger.error("Request demo email send failed", { error: err instanceof Error ? err.message : err });
    return res.status(500).json({ error: "INTERNAL_ERROR", message: "Internal server error" });
  }
});
