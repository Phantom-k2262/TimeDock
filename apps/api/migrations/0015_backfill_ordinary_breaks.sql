UPDATE attendance_entries
SET ordinary_break_minutes = break_minutes
WHERE ordinary_break_minutes = 0
  AND night_break_minutes = 0
  AND break_minutes > 0;
