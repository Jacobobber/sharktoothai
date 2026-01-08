# Retrieval and RAG Strategy
## Purpose
This document defines how the system retrieves information and generates answers in response to user queries. The retrieval and RAG strategy is designed to: - Prefer deterministic, 
explainable data access - Use semantic retrieval only where necessary - Prevent hallucinations through grounding and provenance - Guarantee that no PII or internal identifiers are 
exposed ---
## Guiding Principles
### 1. Deterministic First
If a question can be answered using structured data and SQL, the system must do so. Semantic retrieval is a fallback, not the default.
### 2. Intent-Driven Retrieval
Retrieval strategy is selected based on classified user intent and associated confidence, not on query text alone.
### 3. Grounded Generation
All generated answers are grounded in retrieved source material. The system does not generate speculative content.
### 4. Explicit Provenance
Follow-up questions operate on a frozen context to ensure answer consistency and traceability.
### 5. Zero PII Exposure
No PII or internal identity identifiers are ever exposed to users, LLMs, embeddings, or logs during retrieval or answer generation. ---
## Intent Classification
User queries are classified into an explicit intent schema.
### Characteristics
- Rules-based classification runs first - LLM-based classification is used only as a fallback - Output is schema-validated - Each classification includes a confidence score 
Low-confidence or invalid classifications are treated conservatively. ---
## Retrieval Strategies
### 1. Direct Lookup (SQL)
**Used when:** - Intent confidence is high - Query targets specific structured data (e.g., RO number) **Behavior:** - Executes parameterized SQL queries - Uses deterministic tables 
only - Returns authoritative results This path provides the highest explainability and lowest risk. ---
### 2. Hybrid Retrieval (SQL + Vector)
**Used when:** - Query combines structured and narrative elements - Intent confidence is medium **Behavior:** - Structured filters narrow the candidate set - Redacted semantic chunks 
provide narrative context - Results are combined deterministically This balances precision with semantic flexibility. ---
### 3. Broad Semantic Retrieval (Vector Only)
**Used when:** - Query is exploratory or ambiguous - Intent confidence is low **Behavior:** - Searches over embeddings derived from redacted semantic text only - Uses higher recall 
to avoid false negatives - Never accesses deterministic or PII data directly This path is the most permissive but remains grounded. ---
## Semantic Content Constraints
All semantic retrieval operates on content that is: - Deterministically redacted - Free of PII - Derived only from approved semantic fields No raw or reconstructed PII is available 
to semantic systems. ---
## Answer Generation
### Construction
- Answers are constructed from retrieved material - Citations are mandatory - The system does not invent facts outside retrieved context
### Confidence-Aware Phrasing
Answer tone reflects retrieval confidence: - High confidence → direct, assertive phrasing - Lower confidence → cautious, qualified phrasing This prevents overstatement when data is 
ambiguous. ---
## Provenance Locking
Once an answer is generated: - The retrieval context is frozen - Follow-up questions operate only on this context - No additional retrieval is performed This guarantees consistency 
and traceability across turns. ---
## Internal Identifiers
### `customer_uuid`
- Used internally to support correlation and filtering - Never exposed to users - Never included in LLM prompts - Never embedded or logged Retrieval logic may group or filter 
internally using this identifier, but it is not part of the user-visible model. ---
## Failure and Fallback Behavior
- If retrieval yields no results, the system responds explicitly - If LLM usage is disabled or fails, a deterministic summary is returned - The system does not guess or hallucinate 
Failure modes are explicit and observable. ---
## Security Guarantees
By design, retrieval and RAG guarantee: - No PII exposure - No internal identifier exposure - No hallucinated facts - No cross-tenant access - No ungrounded generation These 
guarantees do not rely on prompt discipline or runtime configuration. ---
## Non-Goals
The retrieval system does not: - Perform autonomous reasoning beyond retrieved data - Reconstruct identity from internal identifiers - Expose intermediate ranking or scoring - 
Optimize for creativity over correctness ---
## Status
This document defines the **authoritative retrieval and RAG behavior**. All answer generation must conform to these constraints.
