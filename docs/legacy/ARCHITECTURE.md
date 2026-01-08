# Architecture (Pilot)

Platform Core vs Workloads:
- Platform gateway centralizes auth, tenant isolation, RBAC, policy, audit, and DB session binding.
- Workloads (RO Assistant) sit behind the gateway, own their schema, and rely on shared types/utils only.

Request flow:
1. requestId → auth (JWT) → tenantGuard (includes tenant active check) → RBAC → policy → RLS context → rateLimit.
2. Handler executes through `withRequestContext` so app.* session vars are set for Postgres RLS.
3. Responses use centralized error handler to avoid leaking internals.

Data layer:
- Postgres with RLS on all tenant tables; app.* session vars set per request.
- pgvector used for embeddings; HNSW index on app.ro_embeddings.

Why Postgres + RLS + pgvector:
- Strong tenant isolation at DB layer; predictable performance for pilot.
- pgvector enables vector search without external services; HNSW index improves retrieval.

Ingestion/search/answer (RO Assistant):
- Ingestion: validate type/size → extract → PII scan (fail closed) → redact → chunk → embed (Azure OpenAI) → store chunks/embeddings → audit.
- Search/answer: embed query via Azure OpenAI, vector search scoped by tenant, return cited redacted excerpts only.

Future MoE expansion:
- Router would call through Platform Core, maintaining tenant context and RLS.
- Model routing would remain workload-scoped; no cross-workload data sharing.
