BEGIN;

CREATE TABLE IF NOT EXISTS app.ro_deterministic_v2 (
  ro_id                 uuid PRIMARY KEY REFERENCES app.repair_orders(ro_id) ON DELETE CASCADE,
  tenant_id             uuid NOT NULL REFERENCES app.tenants(tenant_id) ON DELETE CASCADE,

  ro_number             text,
  ro_status             text,
  open_timestamp        text,
  close_timestamp       text,
  writeup_timestamp     text,
  promised_timestamp    text,
  advisor_id            text,
  service_lane          text,
  department_code       text,
  waiter_flag           text,
  loaner_flag           text,
  warranty_flag         text,
  fleet_flag            text,
  internal_ro_flag      text,

  customer_type         text,
  preferred_contact_method text,
  marketing_opt_in      text,

  vehicle_year          int,
  vehicle_make          text,
  vehicle_model         text,
  vehicle_trim          text,
  vehicle_engine        text,
  vehicle_transmission  text,
  vehicle_drivetrain    text,
  odometer_in           int,
  odometer_out          int,
  vehicle_color         text,
  vehicle_production_date text,

  labor_line_number     int,
  op_code               text,
  labor_type            text,
  skill_level           text,
  flat_rate_hours       numeric(10,2),
  actual_hours          numeric(10,2),
  labor_rate            numeric(10,2),
  labor_extended_amount numeric(10,2),
  technician_id         text,

  part_line_number      int,
  part_number           text,
  part_quantity         numeric(10,2),
  part_unit_price       numeric(10,2),
  part_extended_price   numeric(10,2),
  part_source           text,
  backorder_flag        text,

  labor_total           numeric(10,2),
  parts_total           numeric(10,2),
  shop_fees             numeric(10,2),
  environmental_fees    numeric(10,2),
  discount_total        numeric(10,2),
  tax_total             numeric(10,2),
  grand_total           numeric(10,2),
  payment_method        text,
  invoice_number        text,

  created_by_system     text,
  ingest_timestamp      text,
  tenant_id_source      text,
  source_system         text,

  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ro_deterministic_v2_tenant_idx
  ON app.ro_deterministic_v2 (tenant_id, ro_number);

ALTER TABLE app.ro_deterministic_v2 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ro_deterministic_v2_tenant_isolation ON app.ro_deterministic_v2;
CREATE POLICY ro_deterministic_v2_tenant_isolation
ON app.ro_deterministic_v2
USING (tenant_id = app.current_tenant_id())
WITH CHECK (tenant_id = app.current_tenant_id());

COMMIT;
