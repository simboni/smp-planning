-- Module 26: Public share links.
--
-- A share grants UNAUTHENTICATED, read-only access to one entity (space,
-- folder, list, task, doc or dashboard) via an unguessable token. Management
-- is workspace-scoped like any tenant table; the public resolve path reads the
-- one matching share row under the `app.share_token` RLS context (exactly the
-- pattern the public forms use), then the service loads that single entity's
-- content under a workspace-system context. One live link per entity.

CREATE TABLE IF NOT EXISTS public_shares (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  entity_type  text NOT NULL
    CHECK (entity_type IN ('space', 'folder', 'list', 'task', 'doc', 'dashboard')),
  entity_id    uuid NOT NULL,
  token        text NOT NULL UNIQUE,
  permission   text NOT NULL DEFAULT 'view'
    CHECK (permission IN ('view', 'comment')),
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  -- One share row per entity — re-sharing reuses/refreshes it.
  UNIQUE (workspace_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS public_shares_entity_idx
  ON public_shares (workspace_id, entity_type, entity_id);

ALTER TABLE public_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_shares FORCE ROW LEVEL SECURITY;

-- Workspace members manage their own workspace's shares.
DROP POLICY IF EXISTS public_shares_tenant ON public_shares;
CREATE POLICY public_shares_tenant ON public_shares
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);

-- The unauthenticated resolve path reads exactly the one non-revoked row whose
-- token matches app.share_token; every other RLS policy reads its setting as
-- NULL and denies, so this context can never see anything else.
DROP POLICY IF EXISTS public_shares_public_read ON public_shares;
CREATE POLICY public_shares_public_read ON public_shares FOR SELECT
  USING (
    token = NULLIF(current_setting('app.share_token', true), '')
    AND revoked_at IS NULL
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public_shares TO stackup_app;
