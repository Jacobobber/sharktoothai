import { Router } from "express";
import path from "path";

export const appUiRouter = Router();

const appUiPath = path.join(process.cwd(), "platform/gateway/src/http/app-ui");

appUiRouter.get("/app", (_req, res) => {
  return res.sendFile(path.join(appUiPath, "index.html"));
});

appUiRouter.get("/app/*", (_req, res) => {
  return res.sendFile(path.join(appUiPath, "index.html"));
});
