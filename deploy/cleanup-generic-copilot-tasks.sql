-- One-time cleanup (audit, 27 Nov 2026): Copilot's old built-in planner added
-- the same generic top-level tasks every time it was used. New plans nest
-- these steps under one named task; this tidies up the old copies.
--
-- SAFE BY DESIGN
--   * Archives (does not delete). Archived tasks can be restored by setting
--     archived = false.
--   * Skips any task anyone has touched: done, has subtasks, comments,
--     attachments, checklists or time entries.
--
-- HOW TO RUN (on the server, from /srv/stackup):
--   1. Preview:  run the SELECT below (STEP 1) and read the list.
--   2. Archive:  run STEP 2. It prints how many tasks were archived.
--   3. Undo (if ever needed): STEP 3.

-- STEP 1 — preview ------------------------------------------------------------
SELECT w.name AS workspace, sp.name AS space, l.name AS list, t.name AS task,
       t.created_at::date AS created
  FROM tasks t
  JOIN lists l ON l.id = t.list_id
  JOIN spaces sp ON sp.id = t.space_id
  JOIN workspaces w ON w.id = t.workspace_id
  LEFT JOIN statuses s ON s.id = t.status_id
 WHERE t.archived = false
   AND t.parent_task_id IS NULL
   AND (t.name IN ('Identify owners and key dates',
                   'Break the work into milestones',
                   'Kick off and track progress')
        OR t.name LIKE 'Define scope and goals for %')
   AND s.type IS DISTINCT FROM 'done'
   AND NOT EXISTS (SELECT 1 FROM tasks c WHERE c.parent_task_id = t.id)
   AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.task_id = t.id)
   AND NOT EXISTS (SELECT 1 FROM files f WHERE f.task_id = t.id)
   AND NOT EXISTS (SELECT 1 FROM checklists c WHERE c.task_id = t.id)
   AND NOT EXISTS (SELECT 1 FROM time_entries e WHERE e.task_id = t.id)
 ORDER BY w.name, sp.name, l.name, t.created_at;

-- STEP 2 — archive them (same conditions) --------------------------------------
-- UPDATE tasks t SET archived = true, updated_at = now()
--   FROM statuses s
--  WHERE s.id = t.status_id
--    AND t.archived = false
--    AND t.parent_task_id IS NULL
--    AND (t.name IN ('Identify owners and key dates',
--                    'Break the work into milestones',
--                    'Kick off and track progress')
--         OR t.name LIKE 'Define scope and goals for %')
--    AND s.type IS DISTINCT FROM 'done'
--    AND NOT EXISTS (SELECT 1 FROM tasks c WHERE c.parent_task_id = t.id)
--    AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.task_id = t.id)
--    AND NOT EXISTS (SELECT 1 FROM files f WHERE f.task_id = t.id)
--    AND NOT EXISTS (SELECT 1 FROM checklists c WHERE c.task_id = t.id)
--    AND NOT EXISTS (SELECT 1 FROM time_entries e WHERE e.task_id = t.id);

-- STEP 3 — undo (restores what STEP 2 archived today) -------------------------
-- UPDATE tasks SET archived = false
--  WHERE archived = true AND parent_task_id IS NULL
--    AND (name IN ('Identify owners and key dates',
--                  'Break the work into milestones',
--                  'Kick off and track progress')
--         OR name LIKE 'Define scope and goals for %')
--    AND updated_at::date = current_date;
