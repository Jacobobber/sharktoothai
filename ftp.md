Thanks for the authoritative spec. It conflicts with the implementation we just added in several material ways, so I need your direction before making changes.

Key mismatches vs spec:
- Storage backend: spec mandates object storage ro-ingest-raw/tenant=.../date=.../source=ftp/{uuid}.xml; current code uses local filesystem /data/raw_intake/.../original.xml.
- Directory contract: spec says /incoming/{tenant_id}/; current watcher expects /ftp/incoming/{group_id}/{tenant_id}/YYYY/MM/DD/.
- Idempotency: spec requires SHA-256 dedup on (tenant_id, content_hash); current intake always creates a new batch (no dedup).
- Tracking table: spec requires app.ingest_files with specific fields/statuses; we created app.intake_batches (different schema, no storage_uri, no dedup).
- Pre-ingest validation: spec allows optional size/type/well-formed checks and reject path; current intake does none and never rejects.
- Source is SFTP-only: current watcher is protocol-agnostic (assumes local dir).

To align with the spec, I would:
1) Replace intake_batches with app.ingest_files per spec (or add it alongside and deprecate intake_batches).
2) Change watcher to write to object storage key format and store storage_uri.
3) Enforce dedup (tenant_id, content_hash) and record duplicate status without ingest.
4) Update path parsing to /incoming/{tenant_id}/ (no group_id in path).
5) Implement allowed pre-ingest checks and rejected storage path.
6) Keep ingest invocation untouched (still none).

Please confirm which direction you want:
1) Strictly follow this spec now (replace current intake tables/service).
2) Keep current implementation and treat this spec as future state.
3) Hybrid (add app.ingest_files + object storage paths but keep existing FS watcher for now).

Once you choose, I’ll implement accordingly.
