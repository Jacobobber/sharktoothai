# System Overview
## Purpose
This system provides a secure, compliance-first Repair Order (RO) intelligence and question-answering platform built on Retrieval-Augmented Generation (RAG). It enables users to: - 
Query and analyze automotive repair order data - Retrieve precise, explainable answers grounded in source records - Combine deterministic database queries with semantic understanding 
- Enforce strict data protection and tenant isolation guarantees The system is designed to operate in environments with strong regulatory, privacy, and security requirements. ---
## Core Design Principles
### 1. Structural Data Separation
Data is separated by *class* and *purpose* at ingest time: - Personally Identifiable Information (PII) - Deterministic (structured, queryable) data - Semantic (unstructured, 
narrative) data This separation is enforced structurally, not heuristically.
### 2. PII Safety by Construction
PII is excluded from embeddings, vector search, logs, and LLM prompts by design. No component relies on probabilistic detection to prevent leakage.
### 3. Deterministic First, Semantic Where Needed
Whenever a question can be answered using structured data and SQL, the system does so. Semantic retrieval is used only where narrative understanding is required.
### 4. Explainability and Provenance
All generated answers are grounded in retrieved source material. The system favors traceable, citeable responses over generative speculation.
### 5. Tenant Isolation and Least Privilege
All data access is scoped by tenant and role, enforced at both the application and database layers. ---
## High-Level Architecture
1. **Ingest** - Flat XML input - Field-name–based classification - Structural routing into PII, deterministic, and semantic paths 2. **Secure Storage** - PII encrypted and stored 
   separately - Deterministic data stored in relational tables - Semantic text stored only in redacted form
3. **Indexing** - Deterministic data indexed for SQL queries - Redacted semantic text chunked and embedded using pgvector 4. **Intent Classification** - Rules-based classification 
   with LLM fallback - Confidence-scored and schema-validated intent output
5. **Retrieval** - Direct SQL lookup for high-confidence structured queries - Hybrid SQL + vector retrieval for mixed queries - Vector-only retrieval for low-confidence or 
   exploratory queries
6. **Answer Generation** - Citation-driven response construction - Confidence-aware phrasing - Deterministic fallback when LLM usage is disabled or inappropriate ---
## Security Model (At a Glance)
- No PII is ever embedded or sent to external LLM services - All PII is encrypted at rest and access-controlled by role - Database Row-Level Security (RLS) enforces tenant scoping - 
Audit logs contain only safe metadata (no raw or redacted text) Detailed security and compliance controls are documented separately. ---
## Intended Use
The system is intended to support: - Internal analysis of repair order data - Operational intelligence and reporting - Natural-language querying over structured and unstructured 
records - Secure, explainable AI-assisted workflows The system does **not** depend on any specific data source or dataset and makes no assumptions about the origin of ingested 
records. ---
## Non-Goals
- Real-time transactional processing - Autonomous decision-making - Use of unredacted PII in AI models - Backward compatibility with deprecated data schemas - Heuristic or LLM-based 
PII detection as a primary control ---
## Status
This document describes the **authoritative system model**. All downstream design, implementation, and operational decisions are expected to align with the principles described here.
