-- 0033: Repair public_shares on databases where 0028 didn't fully apply.
--
-- On a drifted live database 0028 was recorded as applied while some of its
-- objects (RLS policies, the app grant, or the unique constraint the create
-- path's ON CONFLICT relies on) never landed — so creating a public share link
-- fails and the UI shows no copyable link. Because 0028 is already recorded,
-- the migrator won't re-run it; this migration re-asserts the WHOLE
-- public_shares setup idempotently, so whatever is missing is filled in and
-- anything already present is left untouched. Safe to run on a healthy DB too.

-- Table (no-op if it already exists).
CREATE TABLE IF NOT EXISTS public_shares (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  entity_type  text NOT NULL
    CHECK (entity_type IN ('space', 'folder', 'list', 'task', 'doc', 'dashboard')),
  entity_id    uuid NOT NULL,
  token        text NOT NULL,
  permission   text NOT NULL DEFAULT 'view'
    CHECK (permission IN ('view', 'comment')),
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz
);

-- Unique on token (public resolve keys on it).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'public_shares_token_key'
  ) THEN
    ALTER TABLE public_shares ADD CONSTRAINT public_shares_token_key UNIQUE (token);
  END IF;
END $$;

-- One live link per entity — REQUIRED by the create path's ON CONFLICT.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'public_shares_workspace_id_entity_type_entity_id_key'
  ) THEN
    ALTER TABLE public_shares
      ADD CONSTRAINT public_shares_workspace_id_entity_type_entity_id_key
      UNIQUE (workspace_id, entity_type, entity_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS public_shares_entity_idx
  ON public_shares (workspace_id, entity_type, entity_id);

ALTER TABLE public_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_shares FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS public_shares_tenant ON public_shares;
CREATE POLICY public_shares_tenant ON public_shares
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);

DROP POLICY IF EXISTS public_shares_public_read ON public_shares;
CREATE POLICY public_shares_public_read ON public_shares FOR SELECT
  USING (
    token = NULLIF(current_setting('app.share_token', true), '')
    AND revoked_at IS NULL
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public_shares TO stackup_app;
