# Schema V2 Documentation ↔ Code Gaps

Gap 1
Document: `docs/01_DATA_CLASSIFICATION_AND_PII.md`, `docs/02_INGEST_PIPELINE.md`
Expected behavior: Unrecognized fields fail ingest; classification is field-name–only, no heuristics.
Actual behavior: `routeXmlToPayloads` routes unknown fields to semantic if they “look text-like”.
Risk assessment: Misclassified fields can bypass structural controls and pollute semantic/embedding paths.
Minimal remediation: Remove heuristic routing and hard-fail any unrecognized field in `workloads/ro-assistant/src/services/ingest/xmlFieldRouting.ts`.

Gap 2
Document: `docs/02_INGEST_PIPELINE.md`
Expected behavior: PII vault write occurs before deterministic persistence.
Actual behavior: `storeRepairOrder` runs before PII vaulting in `workloads/ro-assistant/src/routes/ingest.ts`.
Risk assessment: Violates non-negotiable ordering contract; weakens ingest guarantees.
Minimal remediation: Move all deterministic writes (including `app.repair_orders`) after the vault write.

Gap 3
Document: `docs/01_DATA_CLASSIFICATION_AND_PII.md`, `docs/02_INGEST_PIPELINE.md`, `docs/04_RETRIEVAL_AND_RAG.md`, `docs/06_SECURITY_AND_COMPLIANCE.md`
Expected behavior: Semantic text is deterministically redacted before chunking/embedding; redaction replaces PII tokens.
Actual behavior: `redactPii` is tag-based and does not apply to `buildSemanticXml` output; redaction is effectively a no-op.
Risk assessment: PII can be embedded and sent to LLMs via chunk text and prompts.
Minimal remediation: Implement redaction that targets semantic field content (or apply pattern-based redaction directly to semantic text) prior to chunking in `workloads/ro-assistant/src/routes/ingest.ts`.

Gap 4
Document: `docs/01_DATA_CLASSIFICATION_AND_PII.md`, `docs/06_SECURITY_AND_COMPLIANCE.md`
Expected behavior: No user-facing API returns PII under any circumstances.
Actual behavior: `workloads/ro-assistant/src/routes/pii.ts` decrypts and returns PII; `piiVault.ts` allows read for ADMIN/DEALERADMIN/DEVELOPER.
Risk assessment: Direct PII exposure to user-facing callers.
Minimal remediation: Remove or internalize the PII read endpoint; restrict vault reads to internal service-only paths.

Gap 5
Document: `docs/03_SCHEMA_V2.md`
Expected behavior: Semantic storage uses `app.chunks` and `app.embeddings` tables.
Actual behavior: Code reads/writes `app.ro_chunks` and `app.ro_embeddings`.
Risk assessment: Schema V2 contract is not implemented; migration mismatch and retrieval inconsistencies.
Minimal remediation: Replace usage with Schema V2 table names or add migration that aligns code and schema.

Gap 6
Document: `docs/03_SCHEMA_V2.md`
Expected behavior: `app.repair_orders` holds minimal identity only; deterministic fields live in `app.ro_deterministic_v2`.
Actual behavior: Deterministic fields are written and read from `app.repair_orders` in `workloads/ro-assistant/src/services/ingest/store.ts` and `workloads/ro-assistant/src/routes/ro.ts`.
Risk assessment: Multiple sources of truth and divergence from Schema V2 guarantees.
Minimal remediation: Remove deterministic field writes from `app.repair_orders` and update reads to source from `app.ro_deterministic_v2`.

Gap 7
Document: `docs/03_SCHEMA_V2.md`
Expected behavior: Redacted semantic columns stored in `app.ro_labor_lines` and `app.ro_parts_lines`.
Actual behavior: No semantic columns are persisted in these tables.
Risk assessment: Schema V2 contract not met; semantics only live in chunks.
Minimal remediation: Add redacted semantic writes for op/technician/part descriptions to line-item tables.

Gap 8
Document: `docs/02_INGEST_PIPELINE.md`, `docs/03_SCHEMA_V2.md`
Expected behavior: Invalid or incomplete deterministic data is rejected; no coercion.
Actual behavior: Missing labor rate, extended amounts, and totals are computed and filled in `validateLineItems`.
Risk assessment: Ingest accepts incomplete data, violating “no coercion” guarantee.
Minimal remediation: Require explicit values for labor rate, extended amounts, and totals; remove auto-fill branches.

Gap 9
Document: `docs/00_SYSTEM_OVERVIEW.md`, `docs/04_RETRIEVAL_AND_RAG.md`
Expected behavior: Deterministic-first retrieval for structured queries.
Actual behavior: Retrieval is vector-first for most intents; direct lookup uses semantic chunks, not deterministic tables.
Risk assessment: Queries that should be deterministic depend on semantic retrieval and embeddings.
Minimal remediation: Wire `strictLookup`/`costLookup` into `workloads/ro-assistant/src/routes/answer.ts` for appropriate intents and only fall back to vector when deterministic returns empty.

Gap 10
Document: `docs/06_SECURITY_AND_COMPLIANCE.md`, `docs/07_OPERATIONAL_MODEL.md`
Expected behavior: RLS and Schema V2 baseline migrations are present and enforce tenant isolation.
Actual behavior: No Schema V2 baseline migration or RLS policies are present in repo; only a `0020_customer_uuid.sql` migration exists.
Risk assessment: Tenant isolation and schema guarantees are not reproducible/auditable.
Minimal remediation: Add Schema V2 baseline migration(s) with RLS policies for all authoritative tables.

Gap 11
Document: `docs/06_SECURITY_AND_COMPLIANCE.md`
Expected behavior: Cross-tenant access is prevented.
Actual behavior: `resolveTenantScope` allows DEVELOPER to request arbitrary tenant or group scopes via headers; behavior relies on RLS not present in repo.
Risk assessment: Potential cross-tenant read exposure if RLS is absent or misconfigured.
Minimal remediation: Gate cross-tenant scoping behind explicit non-prod guards or remove it; enforce via RLS-backed policies in migrations.
