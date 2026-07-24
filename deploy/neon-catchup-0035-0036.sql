-- ===========================================================================
-- StackUp — Neon catch-up for the HR module (schema 0035 + 0036)
--
-- Paste this whole file into the Neon SQL editor (as the OWNER role) and Run.
-- It fixes the "internal server error" on the HR and Members pages by
-- creating everything the HR module needs: memberships.title (designations),
-- the departments tables with their RLS policies and grants, and the widened
-- shares principal check.
--
-- Every statement is idempotent — running it twice is harmless. It records
-- the files in schema_migrations so the auto-migrator treats them as applied.
-- ===========================================================================

-- Designation column.
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS title text;

-- Departments (no-op if present).
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
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- The name-uniqueness the create path's 23505 handling relies on.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'departments_workspace_id_name_key'
      AND conrelid = 'departments'::regclass
  ) THEN
    ALTER TABLE departments
      ADD CONSTRAINT departments_workspace_id_name_key UNIQUE (workspace_id, name);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS departments_workspace_idx ON departments (workspace_id);

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS departments_tenant ON departments;
CREATE POLICY departments_tenant ON departments
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON departments TO stackup_app;

-- Department rosters (no-op if present).
CREATE TABLE IF NOT EXISTS department_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES departments (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  dept_role     text NOT NULL DEFAULT 'member' CHECK (dept_role IN ('head', 'member')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- The per-department uniqueness the add path's ON CONFLICT relies on.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'department_members_department_id_user_id_key'
      AND conrelid = 'department_members'::regclass
  ) THEN
    ALTER TABLE department_members
      ADD CONSTRAINT department_members_department_id_user_id_key
      UNIQUE (department_id, user_id);
  END IF;
END $$;

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

-- Shares: departments must be a valid principal. Name-agnostic: drop EVERY
-- check on principal_type that doesn't yet allow 'department' (whatever it
-- was auto-named on this database), then add the widened check only if no
-- department-aware check exists. Re-running is a pure no-op.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'shares'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%principal_type%'
      AND pg_get_constraintdef(oid) NOT LIKE '%department%'
  LOOP
    EXECUTE format('ALTER TABLE shares DROP CONSTRAINT %I', c.conname);
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'shares'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%principal_type%'
      AND pg_get_constraintdef(oid) LIKE '%department%'
  ) THEN
    ALTER TABLE shares ADD CONSTRAINT shares_principal_type_check
      CHECK (principal_type IN ('user', 'team', 'department'));
  END IF;
END $$;

-- Record both migrations as applied.
INSERT INTO schema_migrations (filename) VALUES
  ('0035_departments.sql'),
  ('0036_repair_departments.sql')
ON CONFLICT DO NOTHING;
