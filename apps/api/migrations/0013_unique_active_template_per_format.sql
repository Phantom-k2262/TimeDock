CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_one_active_per_format
  ON templates(export_format)
  WHERE export_format IS NOT NULL AND active = 1;
