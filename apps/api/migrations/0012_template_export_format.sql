ALTER TABLE templates ADD COLUMN export_format TEXT CHECK (export_format IN ('aaaa_sp', 'abcs_regular', 'leave_request', 'sp_report'));
CREATE INDEX IF NOT EXISTS idx_templates_export_format ON templates(export_format, active, created_at);
