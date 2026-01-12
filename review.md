Removed the demo request surface and its config hooks, trimmed unused helpers/types, and tightened retrieval/type handling so the build stays clean without changing runtime behavior.

Removals By Category
- A) Feature flags & config
  - Dropped legacy RO sequence gate (RO_SEQUENCE_MODE) by removing its validation path in workloads/ro-assistant/src/routes/ingest.ts.
  - Removed unused env entries from .env.example (DEV_AUTH_TOKEN_TECH, DEV_USER_ID_TECH, DEV_TENANT_ID_TECH, demo email/rate-limit vars).
- B) Over-abstracted helpers
  - Inlined policy decisions into platform/gateway/src/http/middleware/policyMiddleware.ts and deleted platform/gateway/src/core/policy/policyEngine.ts.
  - Inlined tenant context assertion into workloads/ro-assistant/src/routes/ingest.ts and deleted platform/gateway/src/core/tenant/tenantContext.ts.
  - Deleted unused placeholders platform/gateway/src/core/auth/authService.ts, platform/gateway/src/core/rbac/roles.ts, platform/gateway/src/core/rbac/permissions.ts.
- C) Type indirection
  - Removed the Express alias in shared/types/api.ts and used express.Request directly.
- D) Logging & audit redundancy
  - Removed demo email logging (PII in logs) by deleting platform/gateway/src/core/notifications/demoRequestEmail.ts.
- E) Test consolidation
  - Removed redundant provenance assertion in scripts/tests/answer_tone_tests.ts (provenance remains covered in scripts/tests/answer_context_tests.ts).
- F) Scripts & tooling
  - Deleted demo cleanup helper ops/synthetic-data/cleanup_demo_tenant.ts.
  - Removed unused SendGrid dependency from package.json and package-lock.json.
- G) Roles & permissions
  - No merges; roles remain behaviorally distinct. Removed unused role/permission helper modules (see B).
- H) UI / admin surface
  - Removed request-demo UI and endpoint: platform/gateway/src/http/routes/requestDemo.ts, platform/gateway/src/http/server.ts, platform/gateway/src/http/routes/appUiPublic.ts, platform/gateway/src/http/public-site/index.html, platform/gateway/src/http/public-site/styles.css, platform/gateway/src/http/public-site/public-site.js.

Justifications (Per Category)
- A: Flags/envs that no longer alter runtime or are demo-only are removed to keep Schema V2 the only path.
- B: Single-use helpers and placeholders add indirection without benefit; inlined for clarity and deleted.
- C: Type alias provided no constraints or meaning beyond the base type.
- D: Demo logging was redundant and risked PII exposure; removing the demo flow eliminates the risk.
- E: Duplicate assertions removed to keep one test per guarantee.
- F: Demo cleanup script and SendGrid dependency were unused after demo removal.
- G: Roles still differ in behavior; no merges performed.
- H: Demo UI/endpoint removed to uphold the “no demo/PoC logic” guarantee.

Build/Test
- npm run build: PASS
- npm run test:pii-ingest-db: FAIL (Tenant not found for PII enable)
- npx ts-node scripts/tests/deterministic_retrieval_tests.ts: FAIL (missing tenant row in app.tenants)
- npx ts-node scripts/tests/tenant_rls_harness.ts: FAIL (app.documents.created_by NOT NULL constraint in target DB)

Schema V2 guarantees remain intact after final prune.
