# Hybrid RAG Pipeline Design (Compliance-First)

## Scope
Define a full replacement for the current vector-only RAG pipeline with a hybrid, compliance-first retrieval system for dealership Repair Orders (ROs). This document is authoritative for implementation. No UI work is included.

## Deployment Context
- Private Azure VM
- Node.js/TypeScript backend
- Azure OpenAI used only for embeddings + answer generation
- Local LLM used only for intent classification
- No PII sent to external LLMs, embeddings, prompts, logs, or vector queries
- PII stored only in encrypted vault

## Non-Negotiables
- Intent classification may receive raw user input (including PII)
- Intent classification must run on a local LLM hosted on the Azure VM
- Local LLM is memoryless, offline, classification-only
- External LLM must never receive PII
- No new data stores unless justified

## End-to-End Pipeline (Replacement)
1) **Input Intake**
   - Accept user query (may include PII).
   - Assign request_id, user_id, tenant_id, role, scope.
   - Do not log raw input.

2) **Local LLM Intent Classification (Offline)**
   - Classify intent and extract entities from raw input.
   - Output structured JSON: intent, confidence, entities.
   - No network calls; no memory.

3) **Deterministic Rules (Pre-Retrieval)**
   - Validate/normalize entities (RO number, dates, part numbers, op codes, VIN, name, email, phone).
   - Enforce tenant/group scope + role gating.
   - Select retrieval strategy based on intent.

4) **Retrieval Execution**
   - Structured SQL for strict intents.
   - PII hash lookup to resolve customer_id, then safe RO retrieval.
   - Vector search only for semantic intents.

5) **PII Gating & Context Assembly**
   - Only safe fields and redacted excerpts are allowed in LLM context.
   - PII never enters prompts, embeddings, logs, or vector queries.
   - Context is compact: structured facts table + redacted excerpts.

6) **External LLM Answer**
   - Azure OpenAI receives safe context only.
   - System prompt forbids inventing facts and requires uncertainty labeling.

7) **Audit Logging**
   - Log per-stage activity, counts, and decisions.
   - No raw query or PII in logs.

## Deterministic vs Local LLM Responsibilities
- **Local LLM:** intent classification + entity extraction only.
- **Deterministic rules:** validation, normalization, scope checks, routing, and gating.

## Intent Taxonomy
1) RO_LOOKUP (RO number)
2) DATE_LOOKUP (RO open/close dates)
3) PART_LOOKUP (part number / exact part name)
4) OPCODE_LOOKUP (labor op code)
5) COST_LOOKUP (totals / most expensive)
6) CUSTOMER_LOOKUP (PII: name/email/phone/VIN/license plate)
7) SYMPTOM_DIAGNOSIS (semantic)
8) SERVICE_TYPE (semantic)
9) FREEFORM (unknown/mixed)

## Intent → Retrieval Mapping
- **RO_LOOKUP:** SQL `repair_orders` by ro_number → safe metadata + line items + chunks.
- **DATE_LOOKUP:** SQL by ro_open_date/ro_close_date → safe metadata + line items.
- **PART_LOOKUP:** SQL `ro_parts_lines` by part_number → RO ids → safe metadata.
- **OPCODE_LOOKUP:** SQL `ro_labor_lines` by operation → RO ids → safe metadata.
- **COST_LOOKUP:** SQL totals only (`repair_orders.total_due` or computed sums). If missing → “No cost data available.”
- **CUSTOMER_LOOKUP:** hash PII → `customer_id` lookup → RO ids → safe metadata only.
- **SYMPTOM_DIAGNOSIS / SERVICE_TYPE / FREEFORM:** vector search over redacted chunks.

## PII Gating Rules
- Raw input may contain PII; it is used only for local LLM and hash-based lookup.
- PII is normalized and hashed; plaintext discarded from the pipeline.
- Hashes used only for DB lookup, never logged.
- External LLM receives only safe/redacted content.

## Audit Logging Expectations
Log per stage:
- request_id, tenant_id, user_id, role
- intent, confidence, routing decision
- counts (ROs matched, chunks returned)
No raw input or PII content in logs.

## Local LLM Requirements
- 3–8B model; CPU-friendly
- JSON-only output schema
- Temperature 0 (deterministic)
- Offline runtime (llama.cpp or equivalent)
- Localhost-only binding

## VM Deployment & Isolation
- Local LLM runs as a systemd service
- Bound to 127.0.0.1 only
- Resource limits (CPU/memory) enforced
- Model weights stored locally with restricted permissions

## Failure Modes & Safe Fallbacks
- Low confidence → semantic vector search only
- Invalid entity → ignore entity; semantic search
- PII lookup miss → “No relevant records found.”
- Local LLM down → deterministic regex rules only (no PII lookup)
- External LLM error → deterministic summary of structured results

## Out of Scope
- UI changes
- Cross-tenant analytics
- Storing raw user queries
- New data stores beyond existing Postgres tables
