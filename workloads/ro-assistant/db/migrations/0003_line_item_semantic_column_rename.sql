ALTER TABLE app.ro_labor_lines RENAME COLUMN IF EXISTS op_description_redacted TO op_description;
ALTER TABLE app.ro_labor_lines RENAME COLUMN IF EXISTS technician_notes_redacted TO technician_notes;
ALTER TABLE app.ro_parts_lines RENAME COLUMN IF EXISTS part_description_redacted TO part_description;
