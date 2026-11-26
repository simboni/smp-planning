-- 0045: Re-assert the governance schema (0019), idempotently.
--
-- 0019 is not statement-idempotent (bare CREATE TABLE / CREATE POLICY). The
-- migrator here applies each file in one transaction and stops on any error,
-- so on a database built purely by migrations 0019 is all-or-nothing. But a
-- database restored or hand-patched from elsewhere (this deployment came over
-- from Neon) can hold `custom_roles` without `memberships.custom_role_id`, and
-- every members read selects that column: Members, People, HR, Roles and the
-- department member picker would all fail. This file makes sure every piece
-- of 0019 exists, and changes nothing where it already does.

CREATE TABLE IF NOT EXISTS custom_roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  base_role    text NOT NULL CHECK (base_role IN ('member', 'guest')),
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);
CREATE INDEX IF NOT EXISTS custom_roles_workspace_idx ON custom_roles (workspace_id);
ALTER TABLE custom_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_roles FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'custom_roles' AND policyname = 'custom_roles_tenant'
  ) THEN
    CREATE POLICY custom_roles_tenant ON custom_roles
      USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON custom_roles TO stackup_app;

ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS custom_role_id uuid REFERENCES custom_roles (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS memberships_custom_role_idx
  ON memberships (workspace_id, custom_role_id);
