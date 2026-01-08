BEGIN;

ALTER TABLE app.repair_orders
  ADD COLUMN IF NOT EXISTS customer_uuid uuid;

ALTER TABLE app.ro_deterministic_v2
  ADD COLUMN IF NOT EXISTS customer_uuid uuid;

ALTER TABLE app.pii_vault
  ADD COLUMN IF NOT EXISTS customer_uuid uuid,
  ADD COLUMN IF NOT EXISTS address_hash text;

COMMIT;
