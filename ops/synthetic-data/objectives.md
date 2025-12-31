# Synthetic Dataset Objectives (RO Assistant Pilot)

## Objectives
- Validate that the assistant retrieves the most relevant repair orders for common service queries.
- Confirm tenant-scoped retrieval within a single dealership and prevent cross-tenant access.
- Verify that ambiguous symptoms return appropriate, ranked results without exposing unrelated records.
- Ensure that different phrasing of the same issue maps to the same underlying repair outcomes.
- Confirm that retrieval supports citation-only responses grounded in RO content.
- Check that placeholder-based vehicle descriptors are sufficient for useful retrieval.
- Assess that retrieval avoids false positives when root causes differ within similar symptom families.

## Out of Scope
- Model training or fine-tuning.
- Cost reduction claims or operational ROI measurement.
- Cross-dealer or inter-tenant data sharing or comparison.
- Recommendations, diagnostics, or repair advice beyond retrieval.
