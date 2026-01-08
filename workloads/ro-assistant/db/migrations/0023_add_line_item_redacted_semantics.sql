ALTER TABLE app.ro_labor_lines ADD COLUMN IF NOT EXISTS op_description_redacted text;
ALTER TABLE app.ro_labor_lines ADD COLUMN IF NOT EXISTS technician_notes_redacted text;
ALTER TABLE app.ro_parts_lines ADD COLUMN IF NOT EXISTS part_description_redacted text;
