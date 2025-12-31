# Execution-Ready Blueprint v1.0
GOAL: Implement a modular, secure Platform Core and the RO Assistant workload.
This blueprint is binding. All code must conform.

==================================================
NON-NEGOTIABLES
==================================================
- tenant_id is derived ONLY from auth context, never request payload
- RLS is enabled and enforced in Postgres
- No PII in embeddings, prompts, logs, or vector queries
- PII (if enabled) is encrypted at all times in pii_vault
- No cross-dealership access
- No cross-workload access
- Reference-only outputs; no diagnostics or recommendations

==================================================
SYSTEM SHAPE
==================================================
LOCAL PILOT
- api-gateway (Platform Core + workload router)
- ro-assistant workload
- postgres (pgvector enabled)

PRODUCTION (AZURE)
- Same logical services
- Azure VM (single instance; gateway + workload services)
- Postgres (pgvector enabled; VM-hosted)
- Secrets/keys via VM env or Azure Key Vault (if used)
- Azure OpenAI; PII never sent

==================================================
REPO STRUCTURE
==================================================
repo/
  platform/
    gateway/
      src/
        main.ts
        config.ts
        http/
          server.ts
          middleware/
            requestId.ts
            authContext.ts
            tenantGuard.ts
            rbacGuard.ts
            rateLimit.ts
          routes/
            health.ts
            auth.ts
            audit.ts
            secrets.ts
            policy.ts
            workloads.ts
        core/
          auth/
            authService.ts
            password.ts
            tokens.ts
          rbac/
            roles.ts
            permissions.ts
          tenant/
            tenantContext.ts
          audit/
            auditService.ts
          secrets/
            secretsProvider.ts
          policy/
            policyEngine.ts
        db/
          pg.ts
          rls.ts
  workloads/
    ro-assistant/
      src/
        index.ts
        routes/
          ingest.ts
          search.ts
          ro.ts
          answer.ts
        services/
          ingest/
            validate.ts
            extractText.ts
            redact.ts
            chunk.ts
            embed.ts
            store.ts
          retrieval/
            vectorSearch.ts
            cite.ts
          pii/
            piiEncrypt.ts
            piiVault.ts
          ro/
            roRepo.ts
            chunkRepo.ts
            embedRepo.ts
        db/
          schema.sql
          repo.ts
  shared/
    types/
      api.ts
      domain.ts
    utils/
      logger.ts
      errors.ts
      hash.ts

RULE: workloads may import shared/, never other workloads.

==================================================
REQUEST CONTEXT (TRUST ENVELOPE)
==================================================
type RequestContext = {
  requestId: string
  userId: string
  tenantId: string
  role: "TECH" | "ADMIN" | "PII_APPROVED"
  ip?: string
  userAgent?: string
}

DB session MUST set:
- app.tenant_id
- app.user_id
- app.role

==================================================
PLATFORM GATEWAY RESPONSIBILITIES
==================================================
MIDDLEWARE ORDER:
1. requestId
2. authContext
3. tenantGuard
4. rbacGuard
5. rlsDbContext
6. rateLimit
7. route handler

ROUTES:
- GET  /health
- POST /auth/login
- GET  /auth/me
- GET  /audit
- POST /workloads/ro/ingest
- POST /workloads/ro/search
- POST /workloads/ro/answer
- GET  /workloads/ro/ro/:ro_id
- GET  /workloads/ro/documents/:doc_id/download

==================================================
RO ASSISTANT WORKLOAD CONTRACTS
==================================================

INGEST (ADMIN ONLY)
POST /workloads/ro/ingest

PIPELINE (MANDATORY ORDER):
1. validate file type
2. compute sha256
3. store document
4. extract text
5. redact PII
6. chunk deterministically
7. embed (1536 dims)
8. write repair_orders, ro_chunks, ro_embeddings
9. audit UPLOAD_DOC + INGEST_COMPLETE|FAILED

RULES:
- No unredacted chunk may be stored
- Failures must not leave partial state

--------------------------------------------------

SEARCH (TECH+)
POST /workloads/ro/search

INPUT:
{ query: string, top_k?: number }

OUTPUT:
{
  results: [{
    ro_id,
    ro_number,
    score,
    citations: [{ chunk_id, page_no, excerpt }]
  }]
}

RULES:
- Tenant-scoped only
- Return citations only
- Empty result set if none found
- Audit SEARCH (hash query only)

--------------------------------------------------

ANSWER (TECH+)
POST /workloads/ro/answer

RULES:
- LLM receives ONLY redacted excerpts
- No recommendations
- If insufficient data → "No relevant records found"
- Every statement MUST have citations
- Audit ANSWER

--------------------------------------------------

RO DETAIL (TECH+)
GET /workloads/ro/ro/:ro_id

- Redacted data only
- No PII unless via separate endpoint

==================================================
PII VAULT (OPTIONAL)
==================================================
WRITE (ADMIN):
POST /workloads/ro/pii/:ro_id
- Encrypt server-side
- Store ciphertext only
- Audit PII_WRITE

READ (ADMIN | PII_APPROVED):
GET /workloads/ro/pii/:ro_id
- Decrypt server-side
- Audit PII_READ

PII MUST NEVER JOIN SEARCH/ANSWER PATHS

==================================================
VECTOR SEARCH CONTRACT
==================================================
Single function:

vectorSearch(ctx, queryEmbedding, topK)
-> [{ chunk_id, score }]

SQL MUST:
- WHERE tenant_id = ctx.tenantId
- ORDER BY cosine distance
- LIMIT topK

==================================================
POLICY ENGINE (GLOBAL)
==================================================
Deny if:
- tenant inactive/missing
- role insufficient
- PII endpoint without permission
- payload attempts tenant override
- bulk export without ADMIN

==================================================
AUDIT LOGGING
==================================================
audit.log(ctx, {
  action,
  object_type,
  object_id?,
  metadata? // no raw text or PII
})

==================================================
SECRETS / KEYS
==================================================
interface SecretsProvider {
  get(name)
  getKeyRef(name) -> { keyRef, keyMaterial }
}

Local: env vars
Prod: VM env vars or Azure Key Vault

==================================================
BUILD ORDER
==================================================
1. Gateway + middleware + RequestContext
2. DB wrapper setting app.* vars
3. Apply schema + RLS
4. RO ingestion pipeline
5. pgvector search + citations
6. Answer endpoint
7. Audit logging
8. Optional PII vault endpoints

==================================================
ACCEPTANCE TESTS
==================================================
- Cross-tenant query returns zero results
- TECH cannot ingest
- TECH cannot read PII
- Answer never uncited
- Logs contain no PII or RO text
- Embeddings contain no readable text
- RLS fails closed if app.tenant_id missing

END OF EXECUTION-READY BLUEPRINT v1.0
