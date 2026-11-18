ALTER TABLE attendance_entries ADD COLUMN ordinary_break_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attendance_entries ADD COLUMN night_break_minutes INTEGER NOT NULL DEFAULT 0;
