-- 0038: Department onboarding checklists (HR module).
--
-- Each department can define an onboarding checklist: ordered steps, each
-- with an assignee rule (the NEW MEMBER themselves, the department HEAD, or
-- a SPECIFIC person, e.g. IT) and a due-in-N-days offset. The moment someone
-- is added to the department, the steps become real tasks in an "Onboarding"
-- list inside the department's home Space — assigned, dated and tracked like
-- any other work. The steps table is pure configuration; the created tasks
-- live in the normal tasks tables.
CREATE TABLE IF NOT EXISTS department_onboarding_steps (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  department_id    uuid NOT NULL REFERENCES departments (id) ON DELETE CASCADE,
  title            text NOT NULL,
  assignee_kind    text NOT NULL DEFAULT 'new_member'
    CHECK (assignee_kind IN ('new_member', 'head', 'specific')),
  assignee_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  due_days         int  NOT NULL DEFAULT 7,
  position         int  NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS department_onboarding_steps_dept_idx
  ON department_onboarding_steps (workspace_id, department_id);

ALTER TABLE department_onboarding_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE department_onboarding_steps FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS department_onboarding_steps_tenant ON department_onboarding_steps;
CREATE POLICY department_onboarding_steps_tenant ON department_onboarding_steps
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON department_onboarding_steps TO stackup_app;
