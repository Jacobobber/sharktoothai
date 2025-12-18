# STRO Pilot (Platform Core + RO Assistant)

This repository contains a pilot-ready implementation of the Platform Core gateway and the RO Assistant workload for a single dealership instance. It enforces tenant isolation via Postgres RLS, RBAC-guarded APIs, audited access, and PII-safe ingestion/search/answer flows.

What it is NOT: a multi-tenant production deployment, an enterprise IdP/SSO integration, or a generalized chatbot. Expansion (MoE, cross-workload access, AV scanning, distributed rate limiting) is out of scope for this pilot.

High-level architecture:
- Platform gateway (Express + Postgres) with RLS session binding and middleware chain: requestId → auth → tenant → RBAC → policy → RLS context → rate limit → routes.
- RO Assistant workload behind the gateway; uses dedicated Postgres schema with pgvector for embeddings.
- Azure OpenAI embeddings for ingestion/search/answer; PII detection blocks ingestion before embedding.

Pilot limitations:
- Single instance; in-memory rate limiting.
- Dev bypass optional (development only).
- Azure OpenAI credentials required for embeddings; without them, ingestion/search/answer return embed errors.

Run locally (example):
```bash
cp .env.example .env   # fill in secrets
npm install
npm run db:migrate
SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD=ChangeMe123! npm run ts-node scripts/seed_admin.ts
npm run dev
# login
curl -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" -d '{"email":"admin@example.com","password":"ChangeMe123!"}'
```

Security model summary:
- Auth via JWT (HS256); auth context derived only from verified token.
- Tenant isolation via middleware + app.* session vars + RLS; tenant active check enforced.
- PII safety: ingestion fails closed if PII is detected; redaction runs before storage; no PII in embeddings/logs.
- Audit: auth/RBAC/policy/ingest failures and sensitive actions are logged without raw content.
