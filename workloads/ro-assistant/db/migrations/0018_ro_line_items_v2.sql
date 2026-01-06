BEGIN;

ALTER TABLE app.ro_labor_lines
  ADD COLUMN IF NOT EXISTS labor_index integer,
  ADD COLUMN IF NOT EXISTS labor_line_number integer,
  ADD COLUMN IF NOT EXISTS op_code text,
  ADD COLUMN IF NOT EXISTS labor_type text,
  ADD COLUMN IF NOT EXISTS skill_level text,
  ADD COLUMN IF NOT EXISTS flat_rate_hours numeric(10,2),
  ADD COLUMN IF NOT EXISTS actual_hours numeric(10,2),
  ADD COLUMN IF NOT EXISTS labor_rate numeric(10,2),
  ADD COLUMN IF NOT EXISTS labor_extended_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS technician_id text;

ALTER TABLE app.ro_parts_lines
  ADD COLUMN IF NOT EXISTS labor_index integer,
  ADD COLUMN IF NOT EXISTS part_index integer,
  ADD COLUMN IF NOT EXISTS part_line_number integer,
  ADD COLUMN IF NOT EXISTS part_source text,
  ADD COLUMN IF NOT EXISTS backorder_flag text;

COMMIT;
