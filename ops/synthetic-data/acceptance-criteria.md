# Synthetic Data Acceptance Criteria (RO Assistant Pilot)

## Retrieval Accuracy
- For each scenario in retrieval-scenarios.yaml and retrieval-scenarios-admin.yaml:
  - The top-1 result must be in expected_primary_match.
  - The top-3 results must include expected_primary_match.
  - If acceptable_secondary_matches are returned, they must be within the top-5 results.

## Citation Correctness
- Every response must include citations that map to the returned RO records.
- No response may include a citation to an RO not present in the result set.
- Returned citations must align to the stated repair outcome in the RO narrative.

## Rejection Behavior
- Any input containing PII-like content must be rejected before embedding or storage.
- Requests without a valid auth context must be rejected with no data access.
- Cross-tenant access must return zero results.
- All rejected requests must be logged without raw content.

## Latency
- Queries should complete in a single request/response cycle without manual retries.
- Sustained response times that block interactive use during pilot evaluation are unacceptable.

## Pilot Failure Conditions
- Any instance of PII in embeddings, prompts, logs, or vector queries.
- Any cross-tenant data exposure.
- Failure to return expected_primary_match within top-3 for any defined scenario.
- Citations that reference non-returned or irrelevant ROs.
