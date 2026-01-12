import { execSync } from "child_process";
import fs from "fs";

const roots = ["platform", "workloads", "shared", "scripts", "ops", "app"];
const baseRgArgs = [
  "-n",
  "--hidden",
  "--glob",
  "!.git/**",
  "--glob",
  "!node_modules/**",
  "--glob",
  "!dist/**",
  "--glob",
  "!docs/**",
  "--glob",
  "!specs/**",
  "--glob",
  "!workloads/ro-assistant/db/migrations/**"
];

const run = (cmd: string) => execSync(cmd, { encoding: "utf8" }).trim();

const runRg = (pattern: string, paths = roots, extraArgs: string[] = []) => {
  const cmd = ["rg", ...baseRgArgs, ...extraArgs, pattern, ...paths].join(" ");
  try {
    const out = run(cmd);
    return out ? out.split("\n") : [];
  } catch (err: any) {
    if (err?.status === 1) return [];
    throw err;
  }
};

const readFile = (path: string) => fs.readFileSync(path, "utf8");

const fail = (title: string, details: string[]) => {
  const message = [`[schema-v2-guard] ${title}`, ...details.map((line) => `  - ${line}`)].join("\n");
  throw new Error(message);
};

const checkLegacyTables = () => {
  const matches = runRg("\\bro_chunks\\b|\\bro_embeddings\\b|\\bapp\\.ro_chunks\\b|\\bapp\\.ro_embeddings\\b|\\bro_deterministic\\b");
  if (matches.length) {
    fail("Schema violation: legacy table reference detected", matches);
  }
};

const checkPgcryptoUsage = () => {
  const forbiddenMessage =
    "pgcrypto usage is forbidden; UUIDs must be generated in application code.";
  const sqlMatches = runRg(
    "CREATE EXTENSION\\s+pgcrypto|gen_random_uuid\\(|digest\\(|crypt\\(|hmac\\(",
    ["workloads/ro-assistant/db/migrations"],
    ["-g", "*.sql"]
  );
  if (sqlMatches.length) {
    fail(forbiddenMessage, sqlMatches);
  }

  const codeMatches = runRg("gen_random_uuid\\(|digest\\(|crypt\\(|hmac\\(", ["platform", "workloads"], [
    "-g",
    "*.ts",
    "-g",
    "*.js"
  ]);
  const filtered = codeMatches.filter(
    (line) =>
      !line.startsWith("shared/utils/hash.ts") &&
      !line.startsWith("workloads/ro-assistant/src/services/pii/piiHash.ts") &&
      !line.startsWith("scripts/ftp_intake_watcher.ts")
  );
  if (filtered.length) {
    fail(forbiddenMessage, filtered);
  }
};

const checkDemoLogic = () => {
  const demoFiles = [
    "platform/gateway/src/http/routes/requestDemo.ts",
    "platform/gateway/src/core/notifications/demoRequestEmail.ts",
    "platform/gateway/src/http/public-site/public-site.js"
  ];
  const existing = demoFiles.filter((file) => fs.existsSync(file));
  if (existing.length) {
    fail("Demo regression: demo runtime files present", existing);
  }

  const matches = runRg("request-demo|requestDemo|demoRequestEmail|DEMO_REQUEST_|SENDGRID", [
    "platform/gateway/src/http",
    "platform/gateway/src/core"
  ]);
  if (matches.length) {
    fail("Demo regression: demo routes or config detected", matches);
  }
};

const checkPiiReadEndpoints = () => {
  const matches = runRg("\\/pii\\/", [
    "platform/gateway/src/http/routes",
    "workloads/ro-assistant/src/routes",
    "platform/gateway/src/http/middleware"
  ]);
  if (matches.length) {
    fail("PII regression: PII read endpoint referenced", matches);
  }
};

const checkPiiLogging = () => {
  const files = runRg("decryptPiiPayload", roots, ["-l"]);
  const offenders: string[] = [];
  for (const file of files) {
    const content = readFile(file);
    if (/logger\\.|console\\./.test(content)) {
      offenders.push(file);
    }
  }
  if (offenders.length) {
    fail("PII regression: decrypted PII logged", offenders);
  }
};

const checkEmbeddingRedaction = () => {
  const chunkFiles = runRg("embedChunks\\(", ["workloads/ro-assistant/src"], ["-l"]);
  const offenders: string[] = [];
  for (const file of chunkFiles) {
    const content = readFile(file);
    if (!content.includes("redactSemanticText(")) {
      offenders.push(file);
    }
  }
  if (offenders.length) {
    fail("PII regression: embedding without redacted semantic text", offenders);
  }

  const queryFiles = runRg("embedQuery\\(", ["workloads/ro-assistant/src"], ["-l"]);
  const queryOffenders: string[] = [];
  for (const file of queryFiles) {
    const content = readFile(file);
    if (!content.includes("redactPII(")) {
      queryOffenders.push(file);
    }
  }
  if (queryOffenders.length) {
    fail("PII regression: query embedding without redaction", queryOffenders);
  }
};

const checkTenantHeaderReads = () => {
  const matches = runRg("x-tenant-id|x-scope-tenant-id|x-scope-group-id", ["platform/gateway/src"]);
  const offenders = matches.filter((line) => !line.startsWith("platform/gateway/src/http/middleware/authContext.ts"));
  if (offenders.length) {
    fail("Tenant regression: tenant scope headers read outside authContext", offenders);
  }
};

const checkTestTenantBootstrap = () => {
  const files = runRg("INSERT INTO app\\.", ["scripts/tests"], ["-l"]);
  const offenders: string[] = [];
  for (const file of files) {
    const content = readFile(file);
    const hasBootstrap =
      content.includes("bootstrapTenant(") ||
      content.includes("set_config('app.tenant_id'") ||
      content.includes('set_config("app.tenant_id"');
    if (!hasBootstrap) offenders.push(file);
  }
  if (offenders.length) {
    fail("Tenant regression: test inserts without explicit tenant context", offenders);
  }
};

const checkMigrationImmutability = () => {
  let diff = "";
  const baseSha = process.env.GITHUB_BASE_SHA?.trim();
  try {
    diff = baseSha ? run(`git diff --name-status ${baseSha}...HEAD`) : run("git diff --name-status HEAD~1");
  } catch {
    return;
  }
  if (!diff) return;
  const lines = diff.split("\n").filter(Boolean);
  const offenders: string[] = [];
  for (const line of lines) {
    const [status, file] = line.split(/\s+/);
    if (!file) continue;
    if (
      file.startsWith("workloads/ro-assistant/db/migrations/") &&
      file.endsWith(".sql") &&
      status !== "A"
    ) {
      offenders.push(`${status} ${file}`);
    }
  }
  if (offenders.length) {
    fail("Schema violation: historical migrations modified", offenders);
  }
};

const checkDemoFilesAdded = () => {
  let diff = "";
  const baseSha = process.env.GITHUB_BASE_SHA?.trim();
  try {
    diff = baseSha ? run(`git diff --name-status ${baseSha}...HEAD`) : run("git diff --name-status HEAD~1");
  } catch {
    return;
  }
  if (!diff) return;
  const lines = diff.split("\n").filter(Boolean);
  const offenders: string[] = [];
  for (const line of lines) {
    const [status, file] = line.split(/\s+/);
    if (status !== "A" || !file) continue;
    if (file.startsWith("platform/gateway/src/http/") && /demo/i.test(file)) {
      offenders.push(file);
    }
  }
  if (offenders.length) {
    fail("Demo regression: new demo-related runtime files added", offenders);
  }
};

const main = () => {
  checkLegacyTables();
  checkPgcryptoUsage();
  checkMigrationImmutability();
  checkDemoLogic();
  checkDemoFilesAdded();
  checkPiiReadEndpoints();
  checkPiiLogging();
  checkEmbeddingRedaction();
  checkTenantHeaderReads();
  checkTestTenantBootstrap();
};

try {
  main();
} catch (err: any) {
  console.error(err?.message ?? err);
  process.exit(1);
}
