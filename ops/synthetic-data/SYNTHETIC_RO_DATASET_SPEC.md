Synthetic Repair Order Dataset — Design & Intent Specification

RO Assistant Pilot

1. Purpose of This Document

This document defines the design intent, constraints, and success criteria for generating a synthetic Repair Order (RO) dataset used to demonstrate and validate the RO Assistant pilot.

This dataset is intended to:

Exercise the real ingestion pipeline

Demonstrate high-value semantic retrieval

Support technician, advisor, and service manager use cases

Enable a compelling, defensible demo without using real dealership data

Serve as a long-term regression and demo dataset

This document must be followed exactly by any code generation performed by Codex.

2. Core Principles (Non-Negotiable)

Reality over polish
Synthetic data must resemble real dealership repair orders, including imperfect language, repetition, and ambiguity.

Real pipeline only
Synthetic ROs must pass through the same ingestion, PII gates, chunking, embedding, and storage logic as real ROs.

No shortcuts
No mocks, test-only ingestion paths, database inserts, or bypasses are allowed.

Compliance-first
No PII, real VINs, customer identifiers, phone numbers, emails, or addresses may appear anywhere in the dataset.

Demo gravity
The dataset must enable demos that feel inevitable, not experimental.

3. Source Format: XML Repair Orders
3.1 Canonical Source Format

Input format: XML

Granularity: One Repair Order per XML file

Each XML file represents a single RO as exported from a dealership system

XML was selected because:

It matches common DMS export formats

It enforces structure without oversimplifying

It supports future ingestion paths

3.2 Required XML Content Sections

Each synthetic RO must include the following conceptual sections:

RO Header

Repair Order number (unique, synthetic)

Open date / close date

Mileage (numeric, plausible)

VIN field (placeholder only, clearly marked as synthetic)

Vehicle Information

Year (placeholder)

Make (placeholder)

Model (placeholder)

Customer Concern

Free-text complaint as written by an advisor or customer

Imperfect phrasing encouraged

Technician Diagnostic Narrative

Free-form technician notes

Shorthand, abbreviations, partial sentences allowed

Must reflect real diagnostic reasoning

Labor Operations

Operation code (synthetic)

Description

Labor hours

Parts Line Items

Part number (synthetic placeholder)

Description

Quantity

Unit price (dealer retail scale)

Resolution / Outcome

What ultimately fixed (or did not fix) the issue

Notes about repeat visits if applicable

4. Economic Realism Requirements

To support believable demos and future pricing analysis:

Labor rate: $275/hour (fixed)

Labor times: Realistic for dealership service departments

Parts pricing: Dealer retail scale (not wholesale or discounted)

No free or unrealistic repairs

5. Scenario Diversity Requirements

The dataset must include broad and overlapping scenarios, including but not limited to:

Intermittent no-start conditions

Electrical faults (grounds, sensors, connectors)

Driveability complaints (stalling, hesitation, rough idle)

Suspension noises and wear

HVAC failures (blend doors, compressors, controls)

Repeat visits where:

First repair did not resolve the issue

Second or third visit led to resolution

Cases where:

Multiple parts were replaced before the real cause was found

Diagnostic time was significant

This diversity is critical for meaningful semantic retrieval.

6. Technician Language Requirements

Synthetic text must:

Use technician-style language

Include shorthand and abbreviations

Avoid polished, academic phrasing

Preserve ambiguity and uncertainty where appropriate

Reflect how real technicians document work

Do not normalize grammar or spelling.

7. Administrative & Management Intelligence Use Cases (Combined Prompt 2A)

The dataset must support high-impact, non-obvious questions that service managers, advisors, and parts departments actually care about.

These are read-only intelligence scenarios, not workflow automation.

7.1 Intended Users

Service Managers

Fixed Ops Directors

Service Advisors

Parts Managers

7.2 Required High-Value Use Cases

The dataset must enable retrieval and summarization for scenarios such as:

Quickly quoting common repairs over the phone using prior outcomes

Identifying which parts most often resolved a specific complaint

Detecting repeat comebacks tied to certain repair approaches

Understanding how often a “known issue” actually resulted in replacement vs repair

Finding prior diagnostic paths that avoided unnecessary parts replacement

Comparing labor time patterns across similar repairs

Surfacing repair patterns that span many technicians and months

Reducing incorrect parts ordering by referencing prior successful repairs

Instantly answering “have we seen this before?”

Identifying cases where multiple failed repairs preceded the true fix

These scenarios should feel obvious in hindsight, not contrived.

7.3 Constraints on Administrative Scenarios

No cross-store or multi-dealer assumptions

No PII usage

No automation promises

No write-back

No workflow replacement claims

This is decision support, not system replacement.

8. XML → Ingest-Ready Text Conversion

Synthetic XML files will later be converted into raw .txt files for ingestion.

Conversion rules:

Extract only text that would realistically appear in an RO text export:

Customer concern

Technician diagnostic notes

Labor descriptions

Parts descriptions

Resolution notes

Preserve ordering and context

Do not summarize, clean, normalize, or embellish

One .txt file per RO

Filename must match RO number exactly

9. Validation Requirements (Pre-Ingest Gate)

Before ingestion, the dataset must be validated to ensure:

One-to-one correspondence between XML files and .txt files

All RO numbers are unique

No forbidden patterns exist:

VIN-like strings

Emails

Phone numbers

Files are non-empty

Filenames align with RO numbers

Validation failures must halt ingestion.

10. Success Criteria

This synthetic dataset is considered successful if:

All ROs ingest successfully through the real pipeline

Semantic search produces intuitive, relevant results

Demo queries consistently retrieve meaningful historical context

A service manager can immediately see operational value

The dataset can be reused for future demos without modification

11. Final Instruction to Codex

Codex must:

Treat this document as authoritative

Generate code that strictly adheres to these requirements

Avoid inventing additional fields, shortcuts, or behaviors

Prioritize realism, clarity, and demo impact over novelty
