import { Router } from "express";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { issueToken } from "../../core/auth/tokens";
import { auditLog } from "../../core/audit/auditService";
import { AppError } from "../../../../../shared/utils/errors";
import { loadEnv } from "../../config/env";

const env = loadEnv();
const pool = new Pool({ connectionString: env.databaseUrl });

export const authRouter = Router();

authRouter.post("/auth/login", async (req, res, next) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    return next(new AppError("email and password required", { status: 400, code: "BAD_REQUEST" }));
  }
  const normalizedEmail = String(email).trim().toLowerCase();

  const client = await pool.connect();
  try {
    // SECURITY DEFINER fn handles tenant-active + user-active checks server-side.
    const result = await client.query<{
      user_id: string;
      tenant_id: string | null;
      role: string;
      pass_hash: string;
      user_active: boolean;
      tenant_active: boolean;
    }>(`SELECT * FROM app.auth_login_lookup($1)`, [normalizedEmail]);

    const user = result.rows[0];
    if (!user || !user.user_active || (!user.tenant_active && user.role !== "DEVELOPER")) {
      await auditLog(req as any, { action: "AUTH_DENY", object_type: "auth", metadata: { reason: "invalid_user" } });
      return next(new AppError("Invalid credentials", { status: 401, code: "AUTH_FAILED" }));
    }
    const ok = await bcrypt.compare(password, user.pass_hash);
    if (!ok) {
      await auditLog(req as any, { action: "AUTH_DENY", object_type: "auth", metadata: { reason: "invalid_password" } });
      return next(new AppError("Invalid credentials", { status: 401, code: "AUTH_FAILED" }));
    }
    const token = await issueToken({
      userId: user.user_id,
      tenantId: user.tenant_id ?? undefined,
      role: user.role as any
    });
    const isSecure = process.env.NODE_ENV === "production";
    res.cookie("auth_token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: isSecure,
      path: "/"
    });
    await auditLog(req as any, { action: "LOGIN_SUCCESS", object_type: "auth", metadata: { user_id: user.user_id } });
    return res.status(200).json({ token });
  } catch (err) {
    return next(new AppError("Auth failed", { status: 500, code: "AUTH_FAILED" }));
  } finally {
    client.release();
  }
});

authRouter.post("/auth/logout", async (_req, res) => {
  const isSecure = process.env.NODE_ENV === "production";
  res.clearCookie("auth_token", { path: "/", httpOnly: true, sameSite: "lax", secure: isSecure });
  return res.status(204).send();
});

// /auth/me is mounted in the protected router.
