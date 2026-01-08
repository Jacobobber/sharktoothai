ALTER TABLE app.repair_orders ADD COLUMN IF NOT EXISTS ro_status text;
ALTER TABLE app.repair_orders ADD COLUMN IF NOT EXISTS open_timestamp timestamptz;
ALTER TABLE app.repair_orders ADD COLUMN IF NOT EXISTS close_timestamp timestamptz;
