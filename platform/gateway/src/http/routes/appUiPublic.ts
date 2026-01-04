import { Router } from "express";
import path from "path";

export const appUiPublicRouter = Router();

const appUiPath = path.join(process.cwd(), "platform/gateway/src/http/app-ui");

appUiPublicRouter.get("/login", (_req, res) => {
  return res.sendFile(path.join(appUiPath, "login.html"));
});

appUiPublicRouter.get("/login.js", (_req, res) => {
  return res.sendFile(path.join(appUiPath, "login.js"));
});

appUiPublicRouter.get("/app/styles.css", (_req, res) => {
  return res.sendFile(path.join(appUiPath, "styles.css"));
});

appUiPublicRouter.get("/app/app.js", (_req, res) => {
  return res.sendFile(path.join(appUiPath, "app.js"));
});
