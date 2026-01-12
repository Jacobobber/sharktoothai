BEGIN;

CREATE TABLE IF NOT EXISTS app.ingest_files (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  storage_uri text NOT NULL,
  content_hash text NOT NULL,
  source text NOT NULL DEFAULT 'ftp',
  status text NOT NULL DEFAULT 'RECEIVED',
  error_code text,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('RECEIVED', 'VALIDATED', 'INGESTING', 'INGESTED', 'FAILED', 'DUPLICATE'))
);

ALTER TABLE app.ingest_files
  ADD CONSTRAINT ingest_files_tenant_hash_uniq UNIQUE (tenant_id, content_hash);

CREATE INDEX IF NOT EXISTS ingest_files_status_idx
  ON app.ingest_files (status);
CREATE INDEX IF NOT EXISTS ingest_files_received_at_idx
  ON app.ingest_files (received_at);

ALTER TABLE app.ingest_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ingest_files FORCE ROW LEVEL SECURITY;

CREATE POLICY ingest_files_tenant_select ON app.ingest_files
  FOR SELECT USING (tenant_id = app.current_tenant_id()::text);
CREATE POLICY ingest_files_tenant_insert ON app.ingest_files
  FOR INSERT WITH CHECK (tenant_id = app.current_tenant_id()::text);
CREATE POLICY ingest_files_tenant_update ON app.ingest_files
  FOR UPDATE USING (tenant_id = app.current_tenant_id()::text)
  WITH CHECK (tenant_id = app.current_tenant_id()::text);
CREATE POLICY ingest_files_tenant_delete ON app.ingest_files
  FOR DELETE USING (tenant_id = app.current_tenant_id()::text);

DROP TRIGGER IF EXISTS ingest_files_touch_updated_at ON app.ingest_files;
CREATE TRIGGER ingest_files_touch_updated_at
  BEFORE UPDATE ON app.ingest_files
  FOR EACH ROW
  EXECUTE FUNCTION app.touch_updated_at();

COMMENT ON TABLE app.intake_batches IS
  'DEPRECATED: replaced by app.ingest_files per FTP intake specification.';

COMMIT;
