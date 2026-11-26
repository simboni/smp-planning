-- 0043: Repair the governance setup (0019) on databases where it didn't
--       fully apply.
--
-- 0019 is NOT statement-idempotent: `CREATE TABLE custom_roles`,
-- `CREATE INDEX custom_roles_workspace_idx` and `CREATE POLICY
-- custom_roles_tenant` are all bare, while the one statement the rest of the
-- app depends on — `memberships.custom_role_id` — is LAST.
--
-- The migrator's tolerant mode records a migration as applied when it fails
-- with a duplicate-object SQLSTATE, so on any database where `custom_roles`
-- (or just its index or policy) already existed while the column did not,
-- 0019 was baselined with its transaction rolled back and the column never
-- landed. Nothing later re-asserts it. Because `workspaces.members()` selects
-- `m.custom_role_id` unconditionally, that drift takes out the Members page,
-- People, HR, the Roles page and the department member picker with a
-- permanent 500 — the same failure mode 0036 was written to repair for
-- `memberships.title`.
--
-- This re-asserts the WHOLE governance setup statement by statement, so
-- whatever is missing is filled in and anything already present is left
-- alone. Safe on a healthy database, and safe to run twice.

-- The custom_roles table.
CREATE TABLE IF NOT EXISTS custom_roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  base_role    text NOT NULL CHECK (base_role IN ('member', 'guest')),
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- The name-uniqueness the create path's 23505 handling relies on.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'custom_roles_workspace_id_name_key'
      AND conrelid = 'custom_roles'::regclass
  ) THEN
    ALTER TABLE custom_roles
      ADD CONSTRAINT custom_roles_workspace_id_name_key UNIQUE (workspace_id, name);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS custom_roles_workspace_idx ON custom_roles (workspace_id);

ALTER TABLE custom_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS custom_roles_tenant ON custom_roles;
CREATE POLICY custom_roles_tenant ON custom_roles
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON custom_roles TO stackup_app;

-- The column every members read selects. This is the statement that goes
-- missing on a drifted database, and the reason the pages 500.
ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS custom_role_id uuid REFERENCES custom_roles (id) ON DELETE SET NULL;

-- The FK itself can be absent if the column was added by hand to unbreak a
-- live deploy. Add it only when it isn't already there.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'memberships'::regclass
      AND contype = 'f'
      AND pg_get_constraintdef(oid) LIKE '%custom_role_id%'
  ) THEN
    ALTER TABLE memberships
      ADD CONSTRAINT memberships_custom_role_id_fkey
      FOREIGN KEY (custom_role_id) REFERENCES custom_roles (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS memberships_custom_role_idx
  ON memberships (workspace_id, custom_role_id);
