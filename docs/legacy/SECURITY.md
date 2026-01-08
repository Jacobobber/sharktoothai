# Security Overview (Pilot)

Threat model (pilot scope):
- Single-tenant, single-instance gateway + workload.
- Primary risks: cross-tenant leakage, unauthorized PII exposure, un-audited access, insecure auth bypass.

Tenant isolation strategy:
- Auth context derives only from verified JWT.
- Middleware chain enforces tenant presence and active state before DB access.
- app.* session vars set per request; all SQL uses tenant_id filters; RLS enabled on all tenant tables.

PII handling guarantees:
- Ingestion allows PII and stores it only in `app.pii_vault` (ciphertext only, AEAD, per-workload key ref).
- Active key rotation is supported via a key ring with a distinct `key_ref` per ciphertext.
- Redaction runs before chunking; chunks/embeddings are written only from redacted content.
- No PII in logs, prompts, embeddings, or vector queries; access to the vault is role-gated and audited.
- PII storage and access are disabled by default and must be enabled per tenant.
- PII access requires a reason code and logs `PII_READ`/`PII_WRITE` without raw content.
- PII keys are loaded from environment or Azure Key Vault (`SECRETS_PROVIDER=azure_key_vault`).
- Re-encryption on key rotation is supported via `scripts/pii_reencrypt.ts`.

Audit logging:
- Auth/RBAC/policy/rate-limit denials are audited.
- Ingestion failures audited with stage markers; successful ingress and audit list actions audited.
- Audit records never contain raw RO text or PII.

Known pilot limitations:
- Auth is JWT (HS256) with optional dev bypass in development; no IdP/SSO.
- Rate limiting is in-memory (single instance).
- PII detection uses regex heuristics; no AV or structured PII classification.
- Azure OpenAI embedding dependency; without credentials, embedding requests fail (ingest/search/answer unavailable).
