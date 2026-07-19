-- 0012: Forms (public intake) & Automations.
--
-- Forms: a form targets a List; its fields live in jsonb config. A public
-- token exposes an unauthenticated fill+submit endpoint; each submission
-- creates a task in the target list.
--
-- Automations: per-space rules -- trigger (jsonb) + actions (jsonb array),
-- evaluated by the API when task events happen (and by a periodic scan for
-- due-date triggers). automation_runs is the execution log.

CREATE TABLE forms (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  list_id      uuid NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  -- [{id,label,type:'text'|'textarea'|'email'|'number'|'select'|'date'|'checkbox',
  --   required:bool, options?:[..], asTitle?:bool}]
  fields       jsonb NOT NULL DEFAULT '[]'::jsonb,
  public_token text NOT NULL UNIQUE,
  active       boolean NOT NULL DEFAULT true,
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX forms_workspace_idx ON forms (workspace_id, list_id);
ALTER TABLE forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms FORCE ROW LEVEL SECURITY;
CREATE POLICY forms_tenant ON forms
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
-- The public submit path runs WITHOUT a workspace context: a dedicated
-- fail-closed policy arm grants SELECT by exact token match only.
CREATE POLICY forms_public_read ON forms FOR SELECT
  USING (public_token = NULLIF(current_setting('app.form_token', true), ''));
GRANT SELECT, INSERT, UPDATE, DELETE ON forms TO stackup_app;

CREATE TABLE automations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  space_id     uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  name         text NOT NULL,
  -- {type:'task.created'|'status.changed'|'priority.changed'|'assignee.added'|'due.overdue',
  --  toStatusId?, toPriority?}
  trigger      jsonb NOT NULL,
  -- [{type:'set.status',statusId}|{type:'set.priority',priority}|
  --  {type:'add.assignee',userId}|{type:'add.tag',tagId}|{type:'post.comment',body}]
  actions      jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled      boolean NOT NULL DEFAULT true,
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX automations_space_idx ON automations (workspace_id, space_id, enabled);
ALTER TABLE automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE automations FORCE ROW LEVEL SECURITY;
CREATE POLICY automations_tenant ON automations
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON automations TO stackup_app;

CREATE TABLE automation_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  automation_id uuid NOT NULL REFERENCES automations (id) ON DELETE CASCADE,
  task_id       uuid REFERENCES tasks (id) ON DELETE SET NULL,
  ok            boolean NOT NULL,
  detail        text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX automation_runs_auto_idx ON automation_runs (workspace_id, automation_id, created_at DESC);
ALTER TABLE automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY automation_runs_tenant ON automation_runs
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT ON automation_runs TO stackup_app;

-- Guard automations from re-firing 'due.overdue' repeatedly per task.
CREATE TABLE automation_fired (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  automation_id uuid NOT NULL REFERENCES automations (id) ON DELETE CASCADE,
  task_id       uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  fired_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (automation_id, task_id)
);
ALTER TABLE automation_fired ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_fired FORCE ROW LEVEL SECURITY;
CREATE POLICY automation_fired_tenant ON automation_fired
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, DELETE ON automation_fired TO stackup_app;

-- Public submissions insert tasks without a workspace-scoped session; the
-- API uses a SECURITY DEFINER function so the public path can never touch
-- anything beyond creating one task in the form's target list.
CREATE OR REPLACE FUNCTION submit_form_task(
  p_token text,
  p_name  text,
  p_description text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_form forms%ROWTYPE;
  v_space uuid;
  v_status uuid;
  v_task uuid;
  v_pos numeric;
BEGIN
  SELECT * INTO v_form FROM forms
    WHERE public_token = p_token AND active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'form not found or inactive' USING ERRCODE = 'P0002';
  END IF;
  SELECT space_id INTO v_space FROM lists WHERE id = v_form.list_id;
  -- first not-done status by position
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
  RETURN v_task;
END;
$$;
GRANT EXECUTE ON FUNCTION submit_form_task(text, text, text) TO stackup_app;
