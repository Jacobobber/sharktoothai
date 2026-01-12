BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS chat;

CREATE OR REPLACE FUNCTION app.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
$$;

CREATE TABLE IF NOT EXISTS app.tenants (
  tenant_id uuid PRIMARY KEY,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  pii_enabled boolean NOT NULL DEFAULT true,
  group_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.documents (
  doc_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  filename text NOT NULL,
  mime_type text NOT NULL,
  sha256 bytea NOT NULL,
  storage_path text NOT NULL,
  status text NOT NULL DEFAULT 'stored',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sha256)
);

CREATE TABLE IF NOT EXISTS app.repair_orders (
  ro_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  doc_id uuid NOT NULL,
  ro_number text NOT NULL,
  ro_status text,
  open_timestamp timestamptz,
  close_timestamp timestamptz,
  customer_uuid uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, ro_number)
);

CREATE TABLE IF NOT EXISTS app.ro_deterministic_v2 (
  ro_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  customer_uuid uuid NOT NULL,
  ro_number text,
  ro_status text,
  open_timestamp timestamptz,
  close_timestamp timestamptz,
  writeup_timestamp timestamptz,
  promised_timestamp timestamptz,
  advisor_id text,
  service_lane text,
  department_code text,
  waiter_flag text,
  loaner_flag text,
  warranty_flag text,
  fleet_flag text,
  internal_ro_flag text,
  customer_type text,
  preferred_contact_method text,
  marketing_opt_in text,
  vehicle_year int,
  vehicle_make text,
  vehicle_model text,
  vehicle_trim text,
  vehicle_engine text,
  vehicle_transmission text,
  vehicle_drivetrain text,
  odometer_in int,
  odometer_out int,
  vehicle_color text,
  vehicle_production_date date,
  labor_line_number int,
  op_code text,
  labor_type text,
  skill_level text,
  flat_rate_hours numeric(10,2),
  actual_hours numeric(10,2),
  labor_rate numeric(10,2),
  labor_extended_amount numeric(10,2),
  technician_id text,
  part_line_number int,
  part_number text,
  part_quantity numeric(10,2),
  part_unit_price numeric(10,2),
  part_extended_price numeric(10,2),
  part_source text,
  backorder_flag text,
  labor_total numeric(10,2),
  parts_total numeric(10,2),
  shop_fees numeric(10,2),
  environmental_fees numeric(10,2),
  discount_total numeric(10,2),
  tax_total numeric(10,2),
  grand_total numeric(10,2),
  payment_method text,
  invoice_number text,
  created_by_system text,
  ingest_timestamp timestamptz,
  tenant_id_source text,
  source_system text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.ro_labor_lines (
  labor_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  ro_id uuid NOT NULL,
  labor_index int NOT NULL,
  labor_line_number int,
  op_code text,
  operation text,
  labor_type text,
  skill_level text,
  flat_rate_hours numeric(10,2),
  actual_hours numeric(10,2),
  labor_rate numeric(10,2),
  labor_extended_amount numeric(10,2),
  technician_id text,
  technician_code text,
  op_description text,
  technician_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, ro_id, labor_index)
);

CREATE TABLE IF NOT EXISTS app.ro_parts_lines (
  part_line_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  ro_id uuid NOT NULL,
  labor_index int NOT NULL,
  part_index int NOT NULL,
  part_line_number int,
  part_number text,
  quantity numeric(10,2),
  unit_price numeric(10,2),
  line_total numeric(10,2),
  part_source text,
  backorder_flag text,
  part_description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, ro_id, labor_index, part_index)
);

CREATE TABLE IF NOT EXISTS app.chunks (
  chunk_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  ro_id uuid NOT NULL,
  chunk_text text NOT NULL,
  chunk_index int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, ro_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS app.embeddings (
  embedding_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  chunk_id uuid NOT NULL,
  embedding vector,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.pii_vault (
  tenant_id uuid NOT NULL,
  ro_id uuid NOT NULL,
  customer_id uuid,
  customer_uuid uuid,
  key_ref text NOT NULL,
  nonce bytea NOT NULL,
  ciphertext bytea NOT NULL,
  name_hash text,
  email_hashes text[],
  phone_hashes text[],
  vin_hashes text[],
  license_plate_hashes text[],
  address_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, ro_id)
);

CREATE TABLE IF NOT EXISTS chat.conversations (
  conversation_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat.messages (
  message_id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.documents FORCE ROW LEVEL SECURITY;
ALTER TABLE app.repair_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.repair_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE app.ro_deterministic_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ro_deterministic_v2 FORCE ROW LEVEL SECURITY;
ALTER TABLE app.ro_labor_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ro_labor_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE app.ro_parts_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ro_parts_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE app.chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.chunks FORCE ROW LEVEL SECURITY;
ALTER TABLE app.embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.embeddings FORCE ROW LEVEL SECURITY;
ALTER TABLE app.pii_vault ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.pii_vault FORCE ROW LEVEL SECURITY;
ALTER TABLE chat.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat.conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE chat.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat.messages FORCE ROW LEVEL SECURITY;

CREATE POLICY documents_tenant_select ON app.documents
  FOR SELECT USING (tenant_id = app.current_tenant_id());
CREATE POLICY documents_tenant_insert ON app.documents
  FOR INSERT WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY documents_tenant_update ON app.documents
  FOR UPDATE USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY documents_tenant_delete ON app.documents
  FOR DELETE USING (tenant_id = app.current_tenant_id());

CREATE POLICY repair_orders_tenant_select ON app.repair_orders
  FOR SELECT USING (tenant_id = app.current_tenant_id());
CREATE POLICY repair_orders_tenant_insert ON app.repair_orders
  FOR INSERT WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY repair_orders_tenant_update ON app.repair_orders
  FOR UPDATE USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY repair_orders_tenant_delete ON app.repair_orders
  FOR DELETE USING (tenant_id = app.current_tenant_id());

CREATE POLICY ro_deterministic_v2_tenant_select ON app.ro_deterministic_v2
  FOR SELECT USING (tenant_id = app.current_tenant_id());
CREATE POLICY ro_deterministic_v2_tenant_insert ON app.ro_deterministic_v2
  FOR INSERT WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY ro_deterministic_v2_tenant_update ON app.ro_deterministic_v2
  FOR UPDATE USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY ro_deterministic_v2_tenant_delete ON app.ro_deterministic_v2
  FOR DELETE USING (tenant_id = app.current_tenant_id());

CREATE POLICY ro_labor_lines_tenant_select ON app.ro_labor_lines
  FOR SELECT USING (tenant_id = app.current_tenant_id());
CREATE POLICY ro_labor_lines_tenant_insert ON app.ro_labor_lines
  FOR INSERT WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY ro_labor_lines_tenant_update ON app.ro_labor_lines
  FOR UPDATE USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY ro_labor_lines_tenant_delete ON app.ro_labor_lines
  FOR DELETE USING (tenant_id = app.current_tenant_id());

CREATE POLICY ro_parts_lines_tenant_select ON app.ro_parts_lines
  FOR SELECT USING (tenant_id = app.current_tenant_id());
CREATE POLICY ro_parts_lines_tenant_insert ON app.ro_parts_lines
  FOR INSERT WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY ro_parts_lines_tenant_update ON app.ro_parts_lines
  FOR UPDATE USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY ro_parts_lines_tenant_delete ON app.ro_parts_lines
  FOR DELETE USING (tenant_id = app.current_tenant_id());

CREATE POLICY chunks_tenant_select ON app.chunks
  FOR SELECT USING (tenant_id = app.current_tenant_id());
CREATE POLICY chunks_tenant_insert ON app.chunks
  FOR INSERT WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY chunks_tenant_update ON app.chunks
  FOR UPDATE USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY chunks_tenant_delete ON app.chunks
  FOR DELETE USING (tenant_id = app.current_tenant_id());

CREATE POLICY embeddings_tenant_select ON app.embeddings
  FOR SELECT USING (tenant_id = app.current_tenant_id());
CREATE POLICY embeddings_tenant_insert ON app.embeddings
  FOR INSERT WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY embeddings_tenant_update ON app.embeddings
  FOR UPDATE USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY embeddings_tenant_delete ON app.embeddings
  FOR DELETE USING (tenant_id = app.current_tenant_id());

CREATE POLICY pii_vault_tenant_select ON app.pii_vault
  FOR SELECT USING (tenant_id = app.current_tenant_id());
CREATE POLICY pii_vault_tenant_insert ON app.pii_vault
  FOR INSERT WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY pii_vault_tenant_update ON app.pii_vault
  FOR UPDATE USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY pii_vault_tenant_delete ON app.pii_vault
  FOR DELETE USING (tenant_id = app.current_tenant_id());

CREATE POLICY chat_conversations_tenant_select ON chat.conversations
  FOR SELECT USING (tenant_id = app.current_tenant_id());
CREATE POLICY chat_conversations_tenant_insert ON chat.conversations
  FOR INSERT WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY chat_conversations_tenant_update ON chat.conversations
  FOR UPDATE USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY chat_conversations_tenant_delete ON chat.conversations
  FOR DELETE USING (tenant_id = app.current_tenant_id());

CREATE POLICY chat_messages_tenant_select ON chat.messages
  FOR SELECT USING (tenant_id = app.current_tenant_id());
CREATE POLICY chat_messages_tenant_insert ON chat.messages
  FOR INSERT WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY chat_messages_tenant_update ON chat.messages
  FOR UPDATE USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY chat_messages_tenant_delete ON chat.messages
  FOR DELETE USING (tenant_id = app.current_tenant_id());

-- Smoke checks (manual):
-- SHOW row_security;
-- SELECT app.current_tenant_id();
-- SELECT count(*) FROM app.repair_orders; -- should be 0 without tenant set

COMMIT;
