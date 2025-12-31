# Synthetic Data Safety Rules

## Forbidden Patterns
- Any real or realistic personal names or initials used as identifiers.
- Email addresses or email-like strings.
- Phone numbers or phone-like digit patterns.
- VIN-like identifiers or plate-like strings.
- Physical addresses, street names, or location-specific identifiers.

## PII-Triggering Test Cases
- Intentionally PII-triggering content is not permitted in synthetic datasets.
- Validation checks must block ingestion of any content that resembles PII, even if synthetic.
- If a test requires PII detection verification, it must be executed outside the dataset using controlled, non-persistent inputs.

## Failure Handling
- Any detection of forbidden patterns must result in immediate rejection of the record.
- Failures must be logged with a reason code and a stage marker, without including the offending text.
- Rejected records must not be embedded, stored, or used in vector queries.

## Non-Negotiable Alignment
- No PII in embeddings, prompts, logs, or vector queries.
- All synthetic content must comply with this rule before any processing or storage.
