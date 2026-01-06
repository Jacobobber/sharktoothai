/*
 * Copyright (c) 2024 Jacob Malm. All rights reserved.
 * Proprietary request handling pipeline. Unauthorized redistribution or commercial use is prohibited without prior written consent.
 */

import express from "express";
import { requestId } from "./middleware/requestId";
import { authContext } from "./middleware/authContext";
import { tenantGuard } from "./middleware/tenantGuard";
import { rbacGuard } from "./middleware/rbacGuard";
import { rateLimit } from "./middleware/rateLimit";
import { rlsContext } from "../db/rls";
import { policyMiddleware } from "./middleware/policyMiddleware";
import { errorHandler } from "./middleware/errorHandler";
import { healthRouter } from "./routes/health";
import { authRouter } from "./routes/auth";
import { authMeRouter } from "./routes/authMe";
import { auditRouter } from "./routes/audit";
import { secretsRouter } from "./routes/secrets";
import { policyRouter } from "./routes/policy";
import { workloadsRouter } from "./routes/workloads";
import { adminUiRouter } from "./routes/adminUi";
import { adminApiRouter } from "./routes/adminApi";
import { adminUsersRouter } from "./routes/adminUsers";
import { adminUiPublicRouter } from "./routes/adminUiPublic";
import { appUiPublicRouter } from "./routes/appUiPublic";
import { appUiRouter } from "./routes/appUi";
import { chatRouter } from "./routes/chat";
import { requestDemoRouter } from "./routes/requestDemo";

export const createServer = () => {
  const app = express();

  const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES ?? 5 * 1024 * 1024);
  app.use(express.json({ limit: maxUploadBytes * 2 }));
  app.use(express.urlencoded({ extended: false }));
  app.use(requestId);
  app.use((_req, res, next) => {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; connect-src 'self'"
    );
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });

  // Public Routes
  app.use(healthRouter);
  app.use(authRouter);
  app.use(adminUiPublicRouter);
  app.use(appUiPublicRouter);
  app.use(requestDemoRouter);

  // Auth boundary starts here
  app.use(authContext);
  app.use(tenantGuard);
  app.use(rbacGuard);
  app.use(policyMiddleware);
  app.use(rlsContext);
  app.use(rateLimit);

  // Protected Routes
  app.use(authMeRouter);
  app.use(auditRouter);
  app.use(adminApiRouter);
  app.use(adminUsersRouter);
  app.use(adminUiRouter);
  app.use(appUiRouter);
  app.use(chatRouter);
  app.use(secretsRouter);
  app.use(policyRouter);
  app.use(workloadsRouter);

  app.use(errorHandler);

  return app;
};
