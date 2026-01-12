BEGIN;

CREATE TABLE IF NOT EXISTS app.intake_batches (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  group_id text NOT NULL,
  source text NOT NULL DEFAULT 'ftp',
  filename text NOT NULL,
  checksum text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'RECEIVED',
  locked boolean NOT NULL DEFAULT false,
  notes text,
  CHECK (status IN ('RECEIVED', 'PARSED', 'INGESTED', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS intake_batches_group_tenant_idx
  ON app.intake_batches (group_id, tenant_id);
CREATE INDEX IF NOT EXISTS intake_batches_status_idx
  ON app.intake_batches (status);
CREATE INDEX IF NOT EXISTS intake_batches_received_at_idx
  ON app.intake_batches (received_at);

ALTER TABLE app.intake_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.intake_batches FORCE ROW LEVEL SECURITY;

CREATE POLICY intake_batches_tenant_select ON app.intake_batches
  FOR SELECT USING (tenant_id = app.current_tenant_id()::text);
CREATE POLICY intake_batches_tenant_insert ON app.intake_batches
  FOR INSERT WITH CHECK (tenant_id = app.current_tenant_id()::text);
CREATE POLICY intake_batches_tenant_update ON app.intake_batches
  FOR UPDATE USING (tenant_id = app.current_tenant_id()::text)
  WITH CHECK (tenant_id = app.current_tenant_id()::text);
CREATE POLICY intake_batches_tenant_delete ON app.intake_batches
  FOR DELETE USING (tenant_id = app.current_tenant_id()::text);

CREATE TABLE IF NOT EXISTS app.group_settings (
  group_id text PRIMARY KEY,
  auto_ingest_enabled boolean NOT NULL DEFAULT false,
  raw_intake_retention_days integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.tenant_settings (
  tenant_id text PRIMARY KEY,
  group_id text NOT NULL,
  auto_ingest_enabled boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenant_settings_group_idx
  ON app.tenant_settings (group_id);

CREATE OR REPLACE FUNCTION app.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS group_settings_touch_updated_at ON app.group_settings;
CREATE TRIGGER group_settings_touch_updated_at
  BEFORE UPDATE ON app.group_settings
  FOR EACH ROW
  EXECUTE FUNCTION app.touch_updated_at();

DROP TRIGGER IF EXISTS tenant_settings_touch_updated_at ON app.tenant_settings;
CREATE TRIGGER tenant_settings_touch_updated_at
  BEFORE UPDATE ON app.tenant_settings
  FOR EACH ROW
  EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE app.tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tenant_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_settings_tenant_select ON app.tenant_settings
  FOR SELECT USING (tenant_id = app.current_tenant_id()::text);
CREATE POLICY tenant_settings_tenant_insert ON app.tenant_settings
  FOR INSERT WITH CHECK (tenant_id = app.current_tenant_id()::text);
CREATE POLICY tenant_settings_tenant_update ON app.tenant_settings
  FOR UPDATE USING (tenant_id = app.current_tenant_id()::text)
  WITH CHECK (tenant_id = app.current_tenant_id()::text);
CREATE POLICY tenant_settings_tenant_delete ON app.tenant_settings
  FOR DELETE USING (tenant_id = app.current_tenant_id()::text);

COMMIT;
