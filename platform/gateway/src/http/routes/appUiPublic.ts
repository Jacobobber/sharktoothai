import { Router } from "express";
import path from "path";
import { randomBytes } from "crypto";

export const appUiPublicRouter = Router();

const appUiPath = path.join(process.cwd(), "platform/gateway/src/http/app-ui");
const publicSitePath = path.join(process.cwd(), "platform/gateway/src/http/public-site");

appUiPublicRouter.get("/", (_req, res) => {
  const csrfToken = randomBytes(24).toString("hex");
  res.cookie("st_csrf", csrfToken, {
    httpOnly: false,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  });
  return res.sendFile(path.join(publicSitePath, "index.html"));
});

appUiPublicRouter.get("/styles.css", (_req, res) => {
  res.type("text/css");
  return res.sendFile(path.join(publicSitePath, "styles.css"));
});

appUiPublicRouter.get("/public-site.js", (_req, res) => {
  return res.sendFile(path.join(publicSitePath, "public-site.js"));
});

appUiPublicRouter.get("/security", (_req, res) => {
  return res.sendFile(path.join(publicSitePath, "security.html"));
});

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
