# Codex Task List v1.0
Derived from Execution-Ready Blueprint v1.0. All tasks must honor Non-Negotiables (tenant from auth only, RLS enforced, no PII in embeddings/prompts/logs/vector queries, PII only encrypted in `pii_vault`, no cross-tenant/workload access, reference-only outputs).

## Schema Creation
You are OpenAI Codex acting as a senior backend engineer.

GOAL:
Implement the RO Assistant database schema using the canonical Repair Order template (o.pdf) and the project specifications.

AUTHORITATIVE SPECS (READ FIRST, IN ORDER):
1) specs/platform-doctrine.md
2) specs/platform-core-definition.md
3) specs/ro-assistant-workload-spec.md
4) specs/execution-ready-blueprint.md
5) specs/schema-creation.md

CONSTRAINTS (NON-NEGOTIABLE):
- Instructions in schema-creation.md must be followed.
- tenant_id must be enforced via Postgres RLS
- No plaintext PII outside app.pii_vault
- PII must be encrypted at rest
- No cross-tenant access
- Migrations are immutable
- This task is schema-only (NO ingestion or API logic)

==================================================
TASK
==================================================

1) Create the following migration files exactly:

workloads/ro-assistant/db/migrations/0001_init.sql
workloads/ro-assistant/db/migrations/0002_ro_core.sql
workloads/ro-assistant/db/migrations/0003_ro_line_items.sql
workloads/ro-assistant/db/migrations/0004_pii_vault.sql

Use the schema defined below (DO NOT MODIFY FIELD NAMES OR TABLE STRUCTURE).

2) Create a migration runner at:
scripts/migrate.ts

The runner must:
- Read all .sql files in the migrations directory
- Sort them lexicographically
- Execute each inside a transaction
- Print the filename before executing
- Stop immediately on error

3) Update package.json to include:
"db:migrate": "ts-node scripts/migrate.ts"

4) After writing code, output:
- List of files created
- git-style diffs (or full file contents if new)
- Commands to run migrations locally
- SQL commands to verify RLS and PII enforcement

DO NOT:
- Add seed data
- Add API endpoints
- Add Prisma or other ORMs
- Add features not explicitly requested

==================================================
SCHEMA TO IMPLEMENT (COPY EXACTLY)
==================================================

--- 0001_init.sql ---
[PASTE THE FULL 0001_init.sql CONTENT FROM THE PREVIOUS MESSAGE]

--- 0002_ro_core.sql ---
[PASTE THE FULL 0002_ro_core.sql CONTENT FROM THE PREVIOUS MESSAGE]

--- 0003_ro_line_items.sql ---
[PASTE THE FULL 0003_ro_line_items.sql CONTENT FROM THE PREVIOUS MESSAGE]

--- 0004_pii_vault.sql ---
[PASTE THE FULL 0004_pii_vault.sql CONTENT FROM THE PREVIOUS MESSAGE]

==================================================
VERIFICATION REQUIREMENTS
==================================================

Provide these verification commands at the end:

1) Create DB:
createdb dealer_ai

2) Run migrations:
npm run db:migrate

3) RLS check:
SET app.tenant_id = NULL;
SELECT * FROM app.repair_orders;
-- must return 0 rows or error

4) PII access check:
SET app.tenant_id = '<valid-tenant-id>';
SET app.role = 'TECH';
SELECT * FROM app.pii_vault;
-- must be denied

STOP AFTER COMPLETION.
DO NOT PROCEED TO INGESTION OR API WORK.
END SCHEMA CREATION


## Platform Core / Gateway
1) Bootstrap gateway request pipeline in this order: requestId → authContext → tenantGuard → rbacGuard → rlsDbContext → rateLimit → route handler.
2) Implement RequestContext propagation so DB sessions set `app.tenant_id`, `app.user_id`, `app.role`.
3) Deliver routes:
   - GET `/health`
   - POST `/auth/login`
   - GET `/auth/me`
   - GET `/audit`
   - POST `/workloads/ro/ingest`
   - GET `/workloads/ro/ro/:ro_id`
   - GET `/workloads/ro/documents/:doc_id/download`
4) Wire audit logging (no raw content/PII) and secrets provider interface; integrate policy engine enforcing platform rules.
5) Add Postgres wrapper that binds RLS session variables; fail closed if context missing.

## RO Assistant Workload
6) Define dedicated Postgres schema with pgvector and RLS; separate `pii_vault` (ciphertext only).
7) Build ingestion pipeline (ADMIN only): validate → sha256 → store doc → extract text → redact PII → deterministic chunk → embed (1536 dims) → write `repair_orders`, `ro_chunks`, `ro_embeddings` → audit UPLOAD_DOC + INGEST_COMPLETE|FAILED; ensure no unredacted chunks stored and partial failures roll back.
8) Implement search (TECH+): tenant-scoped vector search returning citations only; audit SEARCH (hash query).
9) Implement answer (TECH+): use only redacted excerpts, require citations, respond “No relevant records found” when insufficient; audit ANSWER.
10) Implement RO detail (TECH+): redacted only; add optional PII endpoints (`/workloads/ro/pii/:ro_id`) with ADMIN/PII_APPROVED controls; PII never joins search/answer.

## Shared / Safety
11) Enforce platform doctrine: workloads isolated, no shared DBs, no secret storage in code/config, models stateless and interchangeable.
12) Acceptance checks: cross-tenant query returns zero results; TECH cannot ingest; TECH cannot read PII; answers never uncited; logs contain no PII or RO text; embeddings contain no readable text; RLS fails closed if `app.tenant_id` missing.
