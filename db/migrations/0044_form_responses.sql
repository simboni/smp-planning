-- 0044: Store form submissions as structured answers, keyed by FIELD ID.
--
-- Until now a submission existed only as the task it created, whose
-- description is a block of "Label: value" lines, and the Responses table was
-- reconstructed by matching those lines against the form's CURRENT labels.
-- That made the data depend on the label text:
--
--   * renaming a field orphaned every earlier answer for it (blank cells, and
--     a response whose only matching label was renamed vanished entirely);
--   * two fields sharing a label collided;
--   * a textarea answer containing a line like "Email: a@b.com" was
--     mis-attributed to the real Email field;
--   * the response count counted any task in the list with a description, so
--     manually created and automation-created tasks inflated it.
--
-- The answers are now written here at submit time, addressed by field id, so
-- a label is only ever a display name. The task and its description stay
-- exactly as they were (they're what people work from), and the read path
-- still falls back to parsing a task's description when no row exists here —
-- so submissions taken before this migration keep showing up.
CREATE TABLE IF NOT EXISTS form_responses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  form_id      uuid NOT NULL REFERENCES forms (id) ON DELETE CASCADE,
  -- The task the submission created. Deleting the task removes the response
  -- row with it, which is what the Responses table should show.
  task_id      uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  -- { "<field id>": "<display value>" } — ids, never labels.
  answers      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id)
);

CREATE INDEX IF NOT EXISTS form_responses_form_idx
  ON form_responses (workspace_id, form_id, created_at DESC);

ALTER TABLE form_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_responses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS form_responses_tenant ON form_responses;
CREATE POLICY form_responses_tenant ON form_responses
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON form_responses TO stackup_app;

-- A public submission has no workspace-scoped session, so it writes through
-- the same SECURITY DEFINER path as the task itself. This is a 4-argument
-- OVERLOAD of submit_form_task: the 3-argument version from 0017 is left in
-- place, so anything still calling it keeps working (it just stores no
-- structured answers).
CREATE OR REPLACE FUNCTION submit_form_task(
  p_token text,
  p_name  text,
  p_description text,
  p_answers jsonb
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
  -- Bind to the form's workspace so the remaining reads/writes pass RLS
  -- without BYPASSRLS (same approach as 0017).
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
    VALUES (v_form.workspace_id, v_form.id, v_task,
            COALESCE(p_answers, '{}'::jsonb))
    ON CONFLICT (task_id) DO UPDATE SET answers = EXCLUDED.answers;
  PERFORM set_config('app.current_workspace', coalesce(v_prev_ws, ''), true);
  RETURN v_task;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_form_task(text, text, text, jsonb) TO stackup_app;

-- ---------------------------------------------------------------------------
-- One-time cleanup: purge custom-field values that point at options which no
-- longer exist on their field.
--
-- Removing an option from a dropdown/labels field never pruned the values
-- already stored on tasks. For a 'labels' field that was fatal: the client
-- rebuilds its payload from the stored array, so every attempt to add or
-- remove a label re-sent the dead id and was rejected — the field could not
-- be edited again on any affected task. The service now prunes on config
-- change; this clears the rows that predate that fix.
-- ---------------------------------------------------------------------------

-- Dropdown: a value pointing at a gone option is cleared outright.
DELETE FROM custom_field_values v
 USING custom_fields f
 WHERE f.id = v.field_id
   AND f.type = 'dropdown'
   AND v.value ? 'optionId'
   AND NOT EXISTS (
     SELECT 1 FROM jsonb_array_elements(COALESCE(f.config->'options', '[]'::jsonb)) AS o
      WHERE o->>'id' = v.value->>'optionId');

-- Labels: the array simply loses the dead entries.
UPDATE custom_field_values v
   SET value = jsonb_build_object(
         'optionIds',
         COALESCE((
           SELECT jsonb_agg(x)
             FROM jsonb_array_elements_text(v.value->'optionIds') AS t(x)
            WHERE EXISTS (
              SELECT 1
                FROM jsonb_array_elements(COALESCE(f.config->'options', '[]'::jsonb)) AS o
               WHERE o->>'id' = x)
         ), '[]'::jsonb))
  FROM custom_fields f
 WHERE f.id = v.field_id
   AND f.type = 'labels'
   AND v.value ? 'optionIds'
   AND EXISTS (
     SELECT 1 FROM jsonb_array_elements_text(v.value->'optionIds') AS t(x)
      WHERE NOT EXISTS (
        SELECT 1
          FROM jsonb_array_elements(COALESCE(f.config->'options', '[]'::jsonb)) AS o
         WHERE o->>'id' = x));
