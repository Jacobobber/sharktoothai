# Repository Guidelines

## Project Structure & Module Organization
- `platform/gateway/`: Express API gateway, auth/RBAC, audit, and DB access.
- `workloads/ro-assistant/`: RO Assistant pipeline (ingest/search/answer) and DB migrations.
- `ops/intake-worker/`: Azure Functions (Node 20) for intake automation.
- `shared/`: Cross-cutting types/utilities shared by gateway and workloads.
- `scripts/`: Operational utilities (migrations, data cleanup, and test harnesses).
- `docs/` and `specs/`: Architecture, security, and execution specs.
- `dist/`: Build output from `npm run build`.

## Build, Test, and Development Commands
- `npm run dev`: Run the gateway in watch mode via `ts-node-dev`.
- `npm run build`: Compile TypeScript to `dist/`.
- `npm run start`: Run the compiled gateway from `dist/`.
- `npm run db:migrate`: Apply SQL migrations in `workloads/ro-assistant/db/migrations`.
- `npm run ci:schema-v2-guards`: Enforce schema v2 guardrails.
- `npm run test:redaction`, `npm run test:pii-scan`, `npm run test:pii-ingest-db`: Run ingestion safety harnesses.
- `ops/intake-worker`: `npm install` then `func start` to run Azure Functions locally.

## Coding Style & Naming Conventions
- TypeScript/JavaScript with 2-space indentation; prefer explicit types at module boundaries.
- Filenames use `camelCase.ts` for services and `snake_case.sql` for migrations.
- Keep middleware and route handlers small; extract logic into services under `platform/` or `workloads/`.
- No formatter is enforced; `npm run lint` is a placeholder.

## Testing Guidelines
- Test harnesses live in `scripts/tests/` and execute via `ts-node`.
- Keep tests focused on ingestion safety, PII scanning, and DB behavior.
- Name test scripts descriptively (e.g., `pii_ingest_db_harness.ts`).

## Commit & Pull Request Guidelines
- Commit history favors short, descriptive subjects (sentences are common); keep subjects concise.
- PRs should include a summary, key commands run (e.g., `npm run test:pii-scan`), and any config/env changes.
- Link related issues and highlight schema or migration impacts.

## Security & Configuration Notes
- Keep secrets out of commits; use `.env` locally and managed identity in production.
- Require `DATABASE_URL` and Azure OpenAI env vars for embedding flows.
- Ingestion is custody-only: do not parse or log PII beyond allowed hashing.
