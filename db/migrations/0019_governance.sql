-- 0019: Governance — custom roles & capability assignment.
--
-- The four built-in roles (owner/admin/member/guest) stay exactly as they are:
-- they remain the identity RLS and the access-token claim key off. Custom roles
-- are an ADDITIVE, workspace-scoped capability layer: an admin defines a named
-- role that derives from a base built-in role (member or guest) and overrides
-- individual capability flags, then assigns it to a member's membership. The
-- effective capability resolution lives in @stackup/shared (resolveCapabilities)
-- and is enforced in the API service layer at capability-gated mutation points.
--
-- The audit log itself already exists (0001, hash-chained + immutable); M17
-- adds only the READ surface in the API, no schema change there.

-- ---------------------------------------------------------------------------
-- Custom roles. capabilities is a partial override map (only the keys the
-- admin flipped away from the base role's default are stored).
-- ---------------------------------------------------------------------------
CREATE TABLE custom_roles (
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

CREATE INDEX custom_roles_workspace_idx ON custom_roles (workspace_id);

ALTER TABLE custom_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY custom_roles_tenant ON custom_roles
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON custom_roles TO stackup_app;

-- ---------------------------------------------------------------------------
-- Assign a custom role to a membership. Nullable: no assignment => the
-- membership's built-in role defaults apply. ON DELETE SET NULL so removing a
-- custom role cleanly reverts everyone holding it to their base role.
-- ---------------------------------------------------------------------------
ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS custom_role_id uuid REFERENCES custom_roles (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS memberships_custom_role_idx
  ON memberships (workspace_id, custom_role_id);
