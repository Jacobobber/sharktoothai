# Schema V2 — Repair Order Data Model
## Purpose
This document defines **Schema V2**, the authoritative data model for Repair Orders (ROs) within the system. Schema V2 replaces all legacy RO schemas and is the **only supported 
model** for ingest, storage, retrieval, and analysis. Its goals are to: - Cleanly separate data by class (PII, deterministic, semantic) - Support deterministic querying and 
calculations - Enable safe semantic retrieval without PII exposure - Enforce realism and integrity constraints at the schema level ---
## Status
**Authoritative.** All legacy RO schemas, tables, and columns are intentionally retired. Backward compatibility is not supported. ---
## Design Principles
### 1. Single Source of Truth
Each category of RO data has exactly one authoritative storage location.
### 2. Flat-Field Representation
ROs are represented using flat fields. There is no XML nesting and no hierarchical schema dependency.
### 3. Indexed Line Items
Multi-line structures (labor and parts) use explicit numeric indices to preserve relationships without nesting.
### 4. Deterministic Integrity
Totals, rates, and relationships are enforced deterministically. Invalid data is rejected rather than coerced.
### 5. PII Isolation
PII does not appear in Schema V2 tables and cannot be reconstructed from them. ---
## Schema Overview
### Core Schemas
- `app` — primary application data - `chat` — conversational data (if enabled) ---
## Authoritative Tables
### 1. `app.repair_orders`
**Purpose:** Minimal identity and lifecycle metadata for each RO. **Characteristics:** - No PII - No semantic text - No calculated totals **Representative Fields:** - `tenant_id` - 
`ro_number` - `ro_status` - `open_timestamp` - `close_timestamp` - `created_at` This table exists to anchor relationships and enforce uniqueness. ---
### 2. `app.ro_deterministic_v2`
**Purpose:** Stores all **Schema V2 deterministic fields** for an RO. **Data Class:** Deterministic only **Characteristics:** - One row per RO - All numeric, enum, date, and flag 
fields - No free-text narrative - No PII **Examples of Stored Fields:** - Vehicle attributes (year, make, model, trim) - Mileage in/out - Financial totals (labor, parts, tax, grand 
total) - Status flags (warranty, fleet, internal) - Payment metadata **Constraints:** - RO number is numeric and 7 digits - Labor rate is fixed at 275.00 - Totals must reconcile 
deterministically - Non-negative monetary values This table is the **authoritative source for calculations and filtering**. ---
### 3. `app.ro_labor_lines`
**Purpose:** Stores indexed labor line items for each RO. **Data Class:** Deterministic + semantic (separated by column) **Characteristics:** - Multiple rows per RO - Indexed by 
`labor_index` - Parent for all associated parts lines **Representative Fields:** - `tenant_id` - `ro_number` - `labor_index` - `op_code` - `labor_type` - `actual_hours` - 
`labor_rate` - `labor_extended_amount` - `technician_id` - `op_description` (semantic, redacted) - `technician_notes` (semantic, redacted) **Constraints:** - Labor indices must be 
contiguous starting at 1 - `labor_rate` must equal 275.00 - `actual_hours` must be within defined bounds ---
### 4. `app.ro_parts_lines`
**Purpose:** Stores indexed parts line items attached to labor lines. **Data Class:** Deterministic + semantic (separated by column) **Characteristics:** - Multiple rows per labor 
line - Indexed by `part_index` - Always attached to a valid labor line **Representative Fields:** - `tenant_id` - `ro_number` - `labor_index` - `part_index` - `part_number` - 
`quantity` - `unit_price` - `extended_price` - `part_description` (semantic, redacted) **Constraints:** - Parts cannot exist without a parent labor line - Part indices must be 
contiguous per labor line - Monetary values must be non-negative ---
### 5. `app.chunks`
**Purpose:** Stores redacted semantic text chunks for retrieval. **Data Class:** Semantic (redacted only) **Characteristics:** - No PII - No deterministic fields - Source-cited text 
only ---
### 6. `app.embeddings`
**Purpose:** Stores vector embeddings for semantic search. **Data Class:** Derived from redacted semantic text only **Characteristics:** - Generated exclusively from `app.chunks` - 
Never contains PII ---
### 7. `app.pii_vault`
**Purpose:** Stores encrypted PII for internal system use only. **Data Class:** PII (encrypted) **Characteristics:** - Ciphertext only - No user-accessible read paths - Tenant-scoped 
- Audited access Schema V2 tables do not reference this table directly. ---
## Explicit Exclusions
Schema V2 explicitly does **not** include: - Customer names, phones, emails, or addresses - VINs or license plates - Free-text narratives outside redacted semantic columns - Legacy 
mixed-purpose RO tables ---
## Integrity and Enforcement
Schema V2 integrity is enforced through: - Ingest-time validation - Database constraints - Indexed line-item rules - Deterministic reconciliation checks If data exists in Schema V2 
tables, it is assumed valid. ---
## Evolution Policy
- Schema V2 may evolve via forward-only migrations - New fields must be explicitly classified - Legacy compatibility is not supported - Any schema change must preserve PII guarantees 
---
### 6. Privacy-Preserving Identity Correlation
Schema V2 supports longitudinal analysis through opaque internal identifiers (e.g., `customer_uuid`) that enable correlation without exposing PII.
## Status
This document defines the **authoritative Repair Order data model**. All ingest, retrieval, analytics, and generation logic must align with Schema V2.
