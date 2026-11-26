-- 0046: CRUD sweep — form answers by field id, and repairs for data the old
-- bugs already left behind. Every statement is safe to run on any database.

-- ---------------------------------------------------------------------------
-- 1. Form responses, stored by field id.
--
-- Submissions used to live only as "Label: value" lines in the created task's
-- description and were read back by matching the CURRENT labels: renaming a
-- field orphaned every earlier answer, two fields sharing a label collided,
-- and a textarea answer containing "Email: …" was mis-filed. Each submission
-- now gets one row here with its answers keyed by field id. Rows for older
-- submissions are marked legacy and still read from the description — there
-- is nothing better to read them from.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS form_responses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  form_id      uuid NOT NULL REFERENCES forms (id) ON DELETE CASCADE,
  task_id      uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  answers      jsonb NOT NULL DEFAULT '{}'::jsonb,
  legacy       boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (form_id, task_id)
);
CREATE INDEX IF NOT EXISTS form_responses_form_idx ON form_responses (form_id, created_at DESC);
ALTER TABLE form_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_responses FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'form_responses' AND policyname = 'form_responses_tenant'
  ) THEN
    CREATE POLICY form_responses_tenant ON form_responses
      USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
  END IF;
END $$;
GRANT SELECT, INSERT, DELETE ON form_responses TO stackup_app;

-- The public submit path (token-scoped, see 0017) now also records answers.
CREATE OR REPLACE FUNCTION submit_form_task(
  p_token       text,
  p_name        text,
  p_description text,
  p_answers     jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_form forms%ROWTYPE;
  v_space uuid;
  v_status uuid;
  v_task uuid;
  v_pos numeric;
  v_prev_ws text := current_setting('app.current_workspace', true);
BEGIN
  SELECT * INTO v_form FROM forms
    WHERE public_token = p_token AND active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'form not found or inactive' USING ERRCODE = 'P0002';
  END IF;
  PERFORM set_config('app.current_workspace', v_form.workspace_id::text, true);
  SELECT space_id INTO v_space FROM lists WHERE id = v_form.list_id;
  SELECT id INTO v_status FROM statuses
    WHERE space_id = v_space AND type <> 'done'
    ORDER BY position LIMIT 1;
  SELECT COALESCE(MAX(position), 0) + 1 INTO v_pos FROM tasks
    WHERE list_id = v_form.list_id AND parent_task_id IS NULL;
  INSERT INTO tasks (workspace_id, list_id, space_id, name, description,
                     status_id, position)
    VALUES (v_form.workspace_id, v_form.list_id, v_space,
            LEFT(p_name, 500), LEFT(p_description, 10000), v_status, v_pos)
    RETURNING id INTO v_task;
  INSERT INTO form_responses (workspace_id, form_id, task_id, answers)
    VALUES (v_form.workspace_id, v_form.id, v_task, COALESCE(p_answers, '{}'::jsonb));
  PERFORM set_config('app.current_workspace', coalesce(v_prev_ws, ''), true);
  RETURN v_task;
END;
$$;
GRANT EXECUTE ON FUNCTION submit_form_task(text, text, text, jsonb) TO stackup_app;

-- Earlier submissions: the same rule the responses page used (a line whose
-- text before the first ":" is one of the form's current field labels).
INSERT INTO form_responses (workspace_id, form_id, task_id, answers, legacy, created_at)
SELECT f.workspace_id, f.id, t.id, '{}'::jsonb, true, t.created_at
  FROM forms f
  JOIN tasks t ON t.list_id = f.list_id AND t.parent_task_id IS NULL
 WHERE coalesce(t.description, '') <> ''
   AND EXISTS (
     SELECT 1
       FROM jsonb_array_elements(f.fields) fe,
            regexp_split_to_table(t.description, E'\n') line
      WHERE position(':' in line) > 1
        AND lower(btrim(split_part(line, ':', 1))) = lower(btrim(fe->>'label'))
   )
ON CONFLICT (form_id, task_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Spaces created by members: the creator gets full control. New spaces do
--    this at creation now; this covers spaces made before. (A member who
--    created a public space resolved to 'edit' and could never rename,
--    recolor, archive or delete it.) An existing explicit share is left as is.
-- ---------------------------------------------------------------------------
INSERT INTO shares
  (workspace_id, object_type, object_id, principal_type, principal_id, permission, created_by)
SELECT s.workspace_id, 'space', s.id, 'user', s.created_by, 'full', s.created_by
  FROM spaces s
  JOIN memberships m
    ON m.workspace_id = s.workspace_id AND m.user_id = s.created_by AND m.role = 'member'
 WHERE s.created_by IS NOT NULL
ON CONFLICT (object_type, object_id, principal_type, principal_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Labels / dropdown values pointing at deleted options. Removing an option
--    never pruned stored values, which bricked a labels field on every task
--    that had the dead option.
-- ---------------------------------------------------------------------------
UPDATE custom_field_values v
   SET value = jsonb_build_object('optionIds', COALESCE(
         (SELECT jsonb_agg(x)
            FROM jsonb_array_elements(COALESCE(v.value->'optionIds', '[]'::jsonb)) x
           WHERE x #>> '{}' IN (SELECT o->>'id' FROM jsonb_array_elements(COALESCE(f.config->'options', '[]'::jsonb)) o)),
         '[]'::jsonb))
  FROM custom_fields f
 WHERE f.id = v.field_id AND f.type = 'labels';
DELETE FROM custom_field_values v
 USING custom_fields f
 WHERE f.id = v.field_id AND f.type = 'labels'
   AND jsonb_array_length(COALESCE(v.value->'optionIds', '[]'::jsonb)) = 0;
DELETE FROM custom_field_values v
 USING custom_fields f
 WHERE f.id = v.field_id AND f.type = 'dropdown'
   AND NOT EXISTS (
     SELECT 1 FROM jsonb_array_elements(COALESCE(f.config->'options', '[]'::jsonb)) o
      WHERE o->>'id' = v.value->>'optionId'
   );

-- ---------------------------------------------------------------------------
-- 4. Org rows left behind by people removed from the workspace (removal now
--    cleans these up itself).
-- ---------------------------------------------------------------------------
DELETE FROM department_members dm
 WHERE NOT EXISTS (SELECT 1 FROM memberships m
                    WHERE m.workspace_id = dm.workspace_id AND m.user_id = dm.user_id);
DELETE FROM team_members tm
 WHERE NOT EXISTS (SELECT 1 FROM memberships m
                    WHERE m.workspace_id = tm.workspace_id AND m.user_id = tm.user_id);
UPDATE departments d SET lead_user_id = NULL
 WHERE d.lead_user_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM memberships m
                    WHERE m.workspace_id = d.workspace_id AND m.user_id = d.lead_user_id);
UPDATE leave_requests lr
   SET status = 'cancelled',
       decision_note = CASE WHEN lr.decision_note = '' THEN 'Withdrawn: left the workspace' ELSE lr.decision_note END
 WHERE (lr.status = 'pending' OR (lr.status = 'approved' AND lr.end_date >= current_date))
   AND NOT EXISTS (SELECT 1 FROM memberships m
                    WHERE m.workspace_id = lr.workspace_id AND m.user_id = lr.user_id);

-- ---------------------------------------------------------------------------
-- 5. One department head: the lead dropdown and the roster's 'head' role used
--    to be set independently. Reconcile them — the lead is the head.
-- ---------------------------------------------------------------------------
-- A roster head but no lead: the earliest head becomes the lead.
UPDATE departments d
   SET lead_user_id = (SELECT dm.user_id FROM department_members dm
                        WHERE dm.department_id = d.id AND dm.dept_role = 'head'
                        ORDER BY dm.created_at LIMIT 1)
 WHERE d.lead_user_id IS NULL
   AND EXISTS (SELECT 1 FROM department_members dm
                WHERE dm.department_id = d.id AND dm.dept_role = 'head');
-- The lead is on the roster, as head.
INSERT INTO department_members (workspace_id, department_id, user_id, dept_role)
SELECT d.workspace_id, d.id, d.lead_user_id, 'head'
  FROM departments d
 WHERE d.lead_user_id IS NOT NULL
ON CONFLICT (department_id, user_id) DO UPDATE SET dept_role = 'head';
-- Nobody else is.
UPDATE department_members dm SET dept_role = 'member'
  FROM departments d
 WHERE d.id = dm.department_id AND dm.dept_role = 'head'
   AND (d.lead_user_id IS NULL OR dm.user_id <> d.lead_user_id);
