-- 0035: Departments & designations (the HR module).
--
-- Workspaces grow past "a list of members": real organizations onboard people
-- into DEPARTMENTS (Finance, Engineering, Operations, ...), give each person a
-- DESIGNATION (job title), and expect a department to have a head and its own
-- home for day-to-day work. Three additions, all purely additive so the
-- existing solo-user and invite flows keep working unchanged:
--
--   1. memberships.title — the member's designation within this workspace
--      (e.g. "Senior Accountant"). Workspace-scoped on purpose: the same
--      person can hold different titles in different workspaces.
--   2. departments + department_members — org units with a color, an optional
--      head (lead_user_id), an optional linked home Space, and a roster where
--      each person is a 'member' or 'head' of the department.
--   3. shares.principal_type gains 'department' — a department can be a share
--      principal exactly like a team, which is how a department's private
--      home Space becomes visible to everyone in the department (and to
--      people added later, with no per-user share bookkeeping).

-- 1. Designation on the membership row. The memberships table already has
--    full DML granted to stackup_app (0001), so no new grant is needed.
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS title text;

-- 2a. Departments.
CREATE TABLE IF NOT EXISTS departments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  color        text NOT NULL DEFAULT '#7B68EE',
  lead_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  space_id     uuid REFERENCES spaces (id) ON DELETE SET NULL,
  sort_order   int  NOT NULL DEFAULT 0,
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS departments_workspace_idx ON departments (workspace_id);

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS departments_tenant ON departments;
CREATE POLICY departments_tenant ON departments
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON departments TO stackup_app;

-- 2b. Department rosters. dept_role marks the department head(s) — display
--     and approval semantics only; workspace privileges stay on memberships.
CREATE TABLE IF NOT EXISTS department_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES departments (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  dept_role     text NOT NULL DEFAULT 'member' CHECK (dept_role IN ('head', 'member')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (department_id, user_id)
);

CREATE INDEX IF NOT EXISTS department_members_workspace_idx
  ON department_members (workspace_id);
CREATE INDEX IF NOT EXISTS department_members_user_idx
  ON department_members (workspace_id, user_id);

ALTER TABLE department_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE department_members FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS department_members_tenant ON department_members;
CREATE POLICY department_members_tenant ON department_members
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON department_members TO stackup_app;

-- 3. Departments as share principals. The inline CHECK from 0003 carries the
--    auto-generated name shares_principal_type_check; replace it idempotently.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'shares_principal_type_check' AND conrelid = 'shares'::regclass
  ) THEN
    ALTER TABLE shares DROP CONSTRAINT shares_principal_type_check;
  END IF;
END $$;

ALTER TABLE shares ADD CONSTRAINT shares_principal_type_check
  CHECK (principal_type IN ('user', 'team', 'department'));
