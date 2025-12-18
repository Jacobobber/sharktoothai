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
import { auditRouter } from "./routes/audit";
import { secretsRouter } from "./routes/secrets";
import { policyRouter } from "./routes/policy";
import { workloadsRouter } from "./routes/workloads";

export const createServer = () => {
  const app = express();

  app.use(express.json({ limit: "1mb" }));
  app.use(requestId);
  app.use(authContext);
  app.use(tenantGuard);
  app.use(rbacGuard);
  app.use(policyMiddleware);
  app.use(rlsContext);
  app.use(rateLimit);

  app.use(healthRouter);
  app.use(authRouter);
  app.use(auditRouter);
  app.use(secretsRouter);
  app.use(policyRouter);
  app.use(workloadsRouter);

  app.use(errorHandler);

  return app;
};
