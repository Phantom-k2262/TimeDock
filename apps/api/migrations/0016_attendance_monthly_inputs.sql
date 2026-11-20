CREATE TABLE attendance_monthly_inputs (
  user_id TEXT NOT NULL REFERENCES users(id),
  target_month TEXT NOT NULL CHECK (target_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  overtime_comment TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, target_month)
);
