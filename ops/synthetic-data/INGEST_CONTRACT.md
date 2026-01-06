# Ingest Contract

This document defines the authoritative ingest routing rules for XML Repair Orders.

## Three Payloads

1. PII payload
   - Raw PII values from explicit XML paths
   - Encrypted and stored in the PII vault only
   - Never embedded or chunked

2. Deterministic payload
   - Structured, numeric, or categorical fields
   - Stored in relational tables for SQL querying

3. Semantic payload
   - Free-form text fields
   - Redacted, chunked, and embedded for vector search

## Ordering Guarantee

Ingest must follow this sequence:

1) Parse XML
2) Route to the three payloads
3) Vault PII payload first (fail if key ring missing)
4) Store deterministic payload
5) Redact semantic payload and verify no raw PII
6) Chunk and embed redacted semantic payload

## Primary Control Rule

XML field names are the primary routing contract. Any new XML fields must be
classified explicitly as PII, deterministic, or semantic in the routing module.
Detection and redaction are defense-in-depth only.

## Example Mapping

Input XML (excerpt):

<repair_order>
  <ro_header>
    <ro_number>RO-1234</ro_number>
    <open_date>2026-01-01</open_date>
  </ro_header>
  <vehicle>
    <vin>SYNTHVIN0000000001</vin>
    <make>Honda</make>
  </vehicle>
  <customer>
    <customer_name>Jane Smith</customer_name>
    <email>jane.smith@example.test</email>
  </customer>
  <customer_concern>
    <concern_text>Brake noise on startup.</concern_text>
  </customer_concern>
</repair_order>

Payload routing:

- PII payload
  - /repair_order/customer/customer_name -> Jane Smith
  - /repair_order/customer/email -> jane.smith@example.test
  - /repair_order/vehicle/vin -> SYNTHVIN0000000001

- Deterministic payload
  - /repair_order/ro_header/ro_number -> RO-1234
  - /repair_order/ro_header/open_date -> 2026-01-01
  - /repair_order/vehicle/make -> Honda

- Semantic payload
  - /repair_order/customer_concern/concern_text -> Brake noise on startup.
