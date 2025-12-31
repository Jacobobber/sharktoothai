# Synthetic RO Generation Strategy

## Approach Comparison
- Hand-authored
  - Strengths: High control, easy to ensure domain accuracy.
  - Weaknesses: Slow, inconsistent coverage, hard to scale beyond small sets.
- Template-driven
  - Strengths: Consistent structure, controllable overlap, predictable coverage.
  - Weaknesses: Can become repetitive without careful variation.
- LLM-assisted
  - Strengths: Fast at producing variations and phrasing diversity.
  - Weaknesses: Risk of drift, hallucinated details, and PII-like artifacts without strict constraints.

## Primary Strategy
Template-driven generation is the primary strategy. It provides consistent structure aligned to retrieval evaluation while enabling controlled variation and overlap. Hand-authored review is used only for final validation of edge cases.

## Prohibited
- Bulk unguided generation is not allowed.

## Intentional Ambiguity and Overlap
- Reuse symptom phrasing across multiple ROs with different root causes.
- Keep diagnosis steps similar while varying the repair actions and outcomes.
- Apply overlapping conditions (e.g., idle vs load, hot vs cold) to create near-duplicate cases.
