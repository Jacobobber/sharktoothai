# Operational Model
## Purpose
This document describes how the system is operated, reset, initialized, and maintained across environments. It defines operational practices that ensure: - system correctness - 
security guarantees - environment hygiene - repeatable initialization These practices are independent of any specific dataset and apply equally to development, testing, and 
controlled operational environments. ---
## Environment Lifecycle
### Environment Types
The system is expected to run in multiple isolated environments, including: - development - testing - staging - production Each environment: - has its own database - has its own 
encryption keys - enforces strict tenant isolation No environment shares data with another. ---
## Initialization and Reset
### Full Environment Reset
In non-production environments, a full reset may be performed to return the system to a clean baseline state. A full reset includes: - removal of all tenants - removal of all users 
and groups - removal of all Repair Orders and related data - removal of all PII vault entries - removal of embeddings and semantic artifacts Full resets are: - explicit - destructive 
- guarded by environment checks - never permitted in production ---
### Schema Initialization
After a reset: - the database schema is initialized using the Schema V2 baseline migration - legacy schemas and tables are intentionally absent - only authoritative schemas are 
present Schema history prior to Schema V2 is treated as archival context, not executable instructions. ---
### Tenant and User Provisioning
After schema initialization: - tenants are created explicitly - users and groups are provisioned explicitly - no implicit or automatic tenant creation occurs Provisioning is 
performed through controlled code paths or administrative tooling. ---
## Data Ingestion Operations
### Ingest Preconditions
Before ingesting data: - schema initialization must be complete - tenant and user context must exist - encryption keys must be available - ingest contracts must be satisfied - ingest 
requests are authenticated using Azure AD Managed Identity tokens scoped to `INGEST_AAD_AUDIENCE`; only allowlisted Managed Identity object IDs may call ingest - intake Azure 
Function callers must acquire a Managed Identity access token for `INGEST_AAD_AUDIENCE` and send `Authorization: Bearer <token>` (no secrets) Ingest behavior is identical 
regardless of data origin. ---
### Ingest Guarantees
For all ingested data: - PII handling guarantees are enforced - deterministic validation is applied - semantic redaction occurs before embedding - failures are explicit and 
non-partial Operational tooling must not bypass ingest safeguards. ---
## Dataset Management
### Non-Production Data
In non-production environments: - data may be reset and re-ingested as needed - data must conform to Schema V2 - ingest validation applies without exception
### Production Data
In production environments: - destructive operations are disabled - data resets are not permitted - schema changes are strictly controlled ---
## Observability and Monitoring
Operational visibility includes: - ingest success and failure rates - retrieval strategy selection - audit events with safe metadata only No observability surface includes: - PII - 
redacted semantic text - decrypted vault contents ---
## Operational Safety Controls
The following controls are enforced operationally: - environment-based feature flags - explicit confirmation for destructive actions - dry-run modes for irreversible operations - 
separation of duties between code and data These controls are designed to prevent accidental data loss or security regressions. ---
## Change Management
### Schema Changes
- must be forward-only - must preserve Schema V2 guarantees - must not reintroduce legacy structures
### Code Changes
- must respect data classification boundaries - must not introduce new PII access paths - must be reviewed against security guarantees ---
## Non-Goals
The operational model does not: - assume a specific dataset - require synthetic or test data - provide self-healing or auto-correction - relax safeguards for convenience ---
## Status
This document defines the **authoritative operational model**. All operational procedures must preserve the security, privacy, and correctness guarantees defined in the system design 
documents.
