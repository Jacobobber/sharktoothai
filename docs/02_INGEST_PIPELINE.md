# Ingest Pipeline
## Purpose
This document defines the ingest pipeline that governs how Repair Order (RO) data enters the system, how it is classified, validated, stored, and prepared for retrieval. The ingest 
pipeline is the **primary enforcement point** for: - data classification - PII protection - schema correctness - realism and integrity constraints Any data that passes ingest is 
guaranteed to satisfy all downstream security and correctness assumptions. ---
## Ingest Inputs
### Supported Input Format
- Flat XML - No XML nesting - Classification based on **element name only** - Indexed suffixes (`_N`, `_N_M`) used for multi-line structures
### Classification Contract
Each XML element name maps deterministically to exactly one class: - PII - Deterministic - Semantic Unrecognized or misclassified fields result in ingest failure. ---
## Strict Processing Order (Non-Negotiable)
Ingest proceeds in the following order. This order is enforced in code and must not be changed. 1. **Parse XML** 2. **Classify fields by name** 3. **Vault PII (raw values)** 4. 
**Persist deterministic data** 5. **Redact semantic data** 6. **Chunk and embed redacted semantic text** This order exists to guarantee that PII is never eligible for semantic 
processing or embedding. ---
## Step-by-Step Pipeline
### 1. XML Parsing
- XML is parsed into a flat key/value structure - Duplicate element names are rejected - Indexed suffixes are parsed but ignored for classification Failure at this stage aborts 
ingest. ---
### 2. Structural Classification
Each field is routed based on its **element name**: - PII fields → PII payload - Deterministic fields → deterministic payload - Semantic fields → semantic payload Classification is: 
- explicit - deterministic - auditable No content inspection or inference is performed. ---
### Internal Customer Identity Assignment
Before PII is vaulted, ingest performs internal customer identity correlation. This step exists solely to support privacy-preserving linkage of multiple Repair Orders belonging to 
the same customer. Process: 1. Raw PII fields are available in-memory within trusted ingest code 2. Deterministic, one-way hashes of selected PII fields are computed 3. A lookup is 
performed within the tenant scope:
   - If a matching customer is found, reuse the existing `customer_uuid` - If no match is found, generate a new `customer_uuid` 4. The resolved `customer_uuid` is: - attached to all 
   PII vault entries - attached to all deterministic RO records
This step occurs **before encryption** and **before any semantic processing**.
### Security Properties
- `customer_uuid` is opaque and non-identifying - No plaintext PII leaves the ingest boundary - No user-accessible surface exists for this identifier - Failure to resolve or assign a 
`customer_uuid` aborts ingest
### 3. PII Vaulting (Primary Control)
- All PII fields are encrypted and written to the PII vault - No plaintext PII is persisted elsewhere - No user-facing access paths exist - Vaulting occurs **before any redaction or 
semantic handling** If vaulting fails, ingest fails. ---
### 4. Deterministic Persistence
- Deterministic fields are validated and normalized - Data is written to Schema V2 deterministic tables - Constraints enforced include: - RO number format (numeric, 7 digits) - Fixed 
  labor rate - Indexed line-item contiguity - Labor/parts parent-child relationships - Realistic totals reconciliation
Invalid data is rejected; no coercion occurs. ---
### 5. Semantic Redaction (Defense-in-Depth)
- Semantic fields are deterministically redacted - Stable placeholder tokens replace PII patterns - Redaction applies only to semantic fields Redaction exists solely as a secondary 
safeguard. Structural exclusion is the primary PII control. ---
### 6. Chunking and Embedding
- Only redacted semantic text is eligible - Text is chunked into bounded segments - Embeddings are generated from redacted text only - Embeddings are stored for vector retrieval Any 
attempt to embed non-redacted text results in failure. ---
## Validation and Guardrails
The ingest pipeline enforces the following invariants: - PII fields can never reach semantic processing - Semantic fields can never bypass redaction - Parts lines must belong to a 
labor line - Line-item indices must be contiguous - Totals must reconcile deterministically - RO numbers must be sequentially valid (configurable strictness) Violations result in 
immediate ingest failure. ---
## Failure Model
- Ingest is **fail-fast** - Partial writes are not permitted - Errors are explicit and actionable - No silent normalization or best-effort fixes If ingest succeeds, downstream 
components may assume: - Schema correctness - PII safety - Data realism ---
## Idempotency and Uniqueness
- Deterministic keys prevent duplicate ROs - Ingest is safe to retry for transient failures - Duplicate detection occurs before semantic processing ---
## Security Guarantees
By construction, ingest guarantees: - PII is never embedded - PII is never logged - PII is never exposed to users - Semantic embeddings contain no PII - Deterministic and semantic 
data are cleanly separated These guarantees do not depend on runtime configuration. ---
## Non-Goals
The ingest pipeline does not: - perform data enrichment - attempt heuristic correction of invalid input - infer missing fields - accept partially valid records - support legacy 
schemas ---
## Status
This document defines the **authoritative ingest behavior**. All producers of RO data must conform to this pipeline. Downstream systems rely on its guarantees.
