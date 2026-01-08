# Data Classification and PII Handling
## Purpose
This document defines how data is classified, stored, and protected throughout the system, with a specific focus on Personally Identifiable Information (PII). The goal is to ensure: 
- PII is protected by construction, not by detection - No PII is exposed to users, embeddings, vector search, logs, or LLM prompts - PII is used only internally by the system where 
strictly required - Data handling is deterministic, auditable, and enforceable This document is authoritative for security, compliance, and implementation. ---
## Data Classification Model
All ingested data is classified into **exactly one** of the following classes at ingest time: 1. **PII (Personally Identifiable Information)** 2. **Deterministic Data** 3. **Semantic 
Data** Classification is explicit and structural. No data may belong to more than one class. ---
## 1. Personally Identifiable Information (PII)
### Definition
PII includes any data that can directly or indirectly identify an individual or a specific privately owned asset. Examples include (non-exhaustive): - Customer first and last name - 
Phone number - Email address - Physical address - Vehicle Identification Number (VIN) - License plate number
### Handling Rules
PII is subject to the strictest controls in the system: - **Storage** - PII is stored only in the encrypted PII vault (`app.pii_vault`) - Data is encrypted at rest using a managed 
  key ring - No plaintext PII is stored outside the vault
- **Access** - PII is **not accessible to end users under any circumstances** - There are no user-facing APIs, UI elements, or roles that return PII - PII may only be accessed 
  programmatically by trusted internal code paths - All access is tenant-scoped and auditable
- **Processing** - PII is never embedded - PII is never included in vector search - PII is never sent to external LLM services - PII is never written to logs (raw or redacted)
### Primary Control
PII exclusion is enforced **structurally** using field-name–based routing at ingest. PII fields are never eligible for semantic processing by design. No probabilistic detection or 
inference is relied upon to protect PII.
### Internal Identity Correlation (`customer_uuid`)
To support longitudinal analysis while preserving privacy, the system assigns an internal, opaque identifier (`customer_uuid`) to correlate multiple Repair Orders belonging to the 
same customer. Key properties: - `customer_uuid` is **not PII** - It is never derived from plaintext PII - It cannot be reversed to reveal identity - It is never exposed to users or 
external systems
### Generation and Assignment
- During ingest, raw PII fields are processed within trusted internal code - Deterministic, one-way hashes of selected PII fields may be used for lookup - If a matching customer is 
found within the same tenant:
  - the existing `customer_uuid` is reused - Otherwise: - a new `customer_uuid` is generated
### Storage and Usage
- `customer_uuid` is stored alongside encrypted PII rows in the PII vault - The same `customer_uuid` is attached to all related Repair Order records - No user-facing API, UI, or 
export exposes `customer_uuid` This mechanism allows internal correlation (e.g., repeat visits) without introducing identity exposure or weakening PII guarantees. ---
## 2. Deterministic Data
### Definition
Deterministic data consists of structured, non-PII fields that: - Are suitable for relational storage - Can be queried deterministically using SQL - Are required for calculations, 
filtering, or reporting Examples include: - Repair order numbers - Dates and timestamps - Monetary totals - Vehicle attributes (year, make, model) - Labor and parts line-item 
metadata - Status flags and enumerations
### Handling Rules
- **Storage** - Stored in Schema V2 deterministic tables - Subject to tenant scoping and database RLS - Enforced with schema-level constraints where applicable - **Processing** - 
  Used for direct SQL lookup and analytics - Never embedded - Never passed to LLMs as free text
- **Guarantees** - Deterministic data is authoritative for calculations and filters - Semantic systems do not override deterministic results ---
## 3. Semantic Data
### Definition
Semantic data consists of unstructured or narrative text that benefits from natural-language understanding. Examples include: - Customer complaints - Technician notes - Advisor 
comments - Cause / correction narratives Semantic data **may contain incidental PII** due to its free-text nature.
### Handling Rules
- **Redaction** - All semantic data is deterministically redacted prior to any downstream use - Redaction replaces PII patterns with stable placeholder tokens (e.g., `<PERSON>`, 
    `<PHONE>`, `<VIN>`)
- **Storage** - Only redacted semantic text is stored outside the PII vault - Redacted text is chunked and embedded for semantic retrieval - **Processing** - Only redacted semantic 
  text may be:
    - embedded - indexed for vector search - included in LLM prompts
### Defense-in-Depth Control
Redaction is applied as a **secondary safeguard**. It exists to protect against: - Accidental PII in free-text fields - Upstream data quality issues - Schema drift or generator 
errors Redaction is **not** the primary mechanism for PII protection. ---
## Explicit Guarantees
The system provides the following guarantees by design: - No PII is embedded - No PII is included in vector search indexes - No PII is sent to external LLM services - No PII is 
written to logs - No PII is returned to users under any circumstances - PII is accessible only to trusted internal code paths Violations of these guarantees result in ingest failure. 
---
## Anti-Patterns (Explicitly Disallowed)
The following practices are intentionally avoided: - User-facing access to PII, regardless of role - Heuristic or LLM-based PII detection as a primary control - Best-effort redaction 
without structural exclusion - Mixing PII with semantic or deterministic data - Silent coercion or sanitization of invalid data ---
## Auditability
All classification and handling decisions are: - deterministic - enforced in code - verifiable via tests - documented in ingest contracts Auditors can reason about PII safety without 
inspecting runtime behavior or user access patterns. ---
## Status
This document defines the **authoritative data classification and PII handling model**. Any changes to data handling must preserve the guarantees described here.
