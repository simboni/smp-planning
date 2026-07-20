-- 0024: allow the M21 advanced dashboard card kinds. The kind column carried
-- an inline CHECK (auto-named dashboard_cards_kind_check); widen it to include
-- completionTrend and overdueByAssignee.

ALTER TABLE dashboard_cards DROP CONSTRAINT IF EXISTS dashboard_cards_kind_check;
ALTER TABLE dashboard_cards
  ADD CONSTRAINT dashboard_cards_kind_check
  CHECK (kind IN (
    'statusBreakdown', 'assigneeLoad', 'priorityBreakdown',
    'timeTracked', 'goalProgress', 'sprintBurndown',
    'recentActivity', 'text',
    'completionTrend', 'overdueByAssignee'
  ));
