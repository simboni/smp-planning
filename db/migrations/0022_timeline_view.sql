-- 0022: allow the 'timeline' view kind (M19). The kind column carried an
-- inline CHECK (auto-named views_kind_check); widen it to include timeline.

ALTER TABLE views DROP CONSTRAINT IF EXISTS views_kind_check;
ALTER TABLE views
  ADD CONSTRAINT views_kind_check
  CHECK (kind IN ('list', 'board', 'calendar', 'table', 'gantt', 'timeline'));
