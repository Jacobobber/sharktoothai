BEGIN;

ALTER TABLE app.repair_orders
  ADD COLUMN IF NOT EXISTS customer_id uuid;

ALTER TABLE app.pii_vault
  ADD COLUMN IF NOT EXISTS customer_id uuid,
  ADD COLUMN IF NOT EXISTS name_hash text,
  ADD COLUMN IF NOT EXISTS email_hashes text[],
  ADD COLUMN IF NOT EXISTS phone_hashes text[],
  ADD COLUMN IF NOT EXISTS vin_hashes text[],
  ADD COLUMN IF NOT EXISTS license_plate_hashes text[];

CREATE INDEX IF NOT EXISTS repair_orders_customer_id_idx
  ON app.repair_orders (tenant_id, customer_id);

CREATE INDEX IF NOT EXISTS pii_vault_customer_id_idx
  ON app.pii_vault (tenant_id, customer_id);

CREATE INDEX IF NOT EXISTS pii_vault_name_hash_idx
  ON app.pii_vault (tenant_id, name_hash);

CREATE INDEX IF NOT EXISTS pii_vault_email_hashes_gin
  ON app.pii_vault USING gin (email_hashes);

CREATE INDEX IF NOT EXISTS pii_vault_phone_hashes_gin
  ON app.pii_vault USING gin (phone_hashes);

CREATE INDEX IF NOT EXISTS pii_vault_vin_hashes_gin
  ON app.pii_vault USING gin (vin_hashes);

CREATE INDEX IF NOT EXISTS pii_vault_license_hashes_gin
  ON app.pii_vault USING gin (license_plate_hashes);

CREATE OR REPLACE FUNCTION app.lookup_customer_ids(p_tenant_id uuid, p_hashes text[])
RETURNS TABLE(customer_id uuid, ro_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = app, public
AS $$
  SELECT DISTINCT customer_id, ro_id
  FROM app.pii_vault
  WHERE tenant_id = p_tenant_id
    AND customer_id IS NOT NULL
    AND (
      name_hash = ANY(p_hashes)
      OR (email_hashes IS NOT NULL AND email_hashes && p_hashes)
      OR (phone_hashes IS NOT NULL AND phone_hashes && p_hashes)
      OR (vin_hashes IS NOT NULL AND vin_hashes && p_hashes)
      OR (license_plate_hashes IS NOT NULL AND license_plate_hashes && p_hashes)
    );
$$;

GRANT EXECUTE ON FUNCTION app.lookup_customer_ids(uuid, text[]) TO PUBLIC;

COMMIT;
