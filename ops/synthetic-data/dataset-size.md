# Synthetic Dataset Size (Pilot)

## Size Targets
- Total RO count: 100
- Number of vehicles: 50
- Number of recurring symptom patterns: 15
- Number of intentionally ambiguous cases: 8

## Rationale
This size is sufficient to validate retrieval quality, tenant scoping, and ambiguity handling without introducing operational overhead. One hundred ROs provide enough repetition to test similarity ranking and disambiguation while remaining manageable for ingestion, inspection, and iteration during a pilot.

## Why Larger Is Counterproductive Now
A larger dataset would slow ingestion cycles, increase review time, and make it harder to isolate retrieval issues. For pilot validation, faster iteration and clear traceability are more valuable than scale.
