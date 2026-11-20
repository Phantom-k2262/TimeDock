PRAGMA foreign_keys = ON;

ALTER TABLE attendance_entries ADD COLUMN work_code TEXT NOT NULL DEFAULT '';
