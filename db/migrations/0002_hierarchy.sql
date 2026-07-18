-- 0002: The Hierarchy — Spaces -> Folders -> Lists.
--
-- ClickUp's structure: a Workspace contains Spaces; a Space contains Folders
-- and/or folderless Lists; a Folder contains Lists. Tasks (M3) will live in
-- Lists. Every table follows the workspace-RLS pattern from 0001.
--
-- Ordering: each container keeps an integer sort_order for manual arrangement.
-- Deletion cascades down (delete a Space -> its Folders and Lists go too);
-- soft-hiding is done with `archived` (ClickUp's "archive") so nothing is lost
-- unless explicitly deleted.

-- ---------------------------------------------------------------------------
-- Spaces — the top division inside a workspace (department / team / client).
-- ---------------------------------------------------------------------------
CREATE TABLE spaces (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name         text NOT NULL,
  color        text NOT NULL DEFAULT '#7B68EE',
  icon         text,                              -- emoji or icon key, optional
  is_private   boolean NOT NULL DEFAULT false,    -- full permissions land in M2
  archived     boolean NOT NULL DEFAULT false,
  sort_order   int NOT NULL DEFAULT 0,
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX spaces_workspace_idx ON spaces (workspace_id, archived, sort_order);

ALTER TABLE spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE spaces FORCE ROW LEVEL SECURITY;
CREATE POLICY spaces_tenant ON spaces
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON spaces TO stackup_app;

-- ---------------------------------------------------------------------------
-- Folders — optional grouping of Lists inside a Space.
-- ---------------------------------------------------------------------------
CREATE TABLE folders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  space_id     uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  name         text NOT NULL,
  archived     boolean NOT NULL DEFAULT false,
  sort_order   int NOT NULL DEFAULT 0,
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX folders_space_idx ON folders (workspace_id, space_id, archived, sort_order);

ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE folders FORCE ROW LEVEL SECURITY;
CREATE POLICY folders_tenant ON folders
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON folders TO stackup_app;

-- ---------------------------------------------------------------------------
-- Lists — the container that will hold Tasks (M3). A List belongs to a Space
-- and is EITHER inside a Folder (folder_id set) OR folderless (folder_id NULL).
-- ---------------------------------------------------------------------------
CREATE TABLE lists (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  space_id     uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  folder_id    uuid REFERENCES folders (id) ON DELETE CASCADE,   -- NULL = folderless
  name         text NOT NULL,
  color        text,
  archived     boolean NOT NULL DEFAULT false,
  sort_order   int NOT NULL DEFAULT 0,
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX lists_space_idx ON lists (workspace_id, space_id, folder_id, archived, sort_order);

ALTER TABLE lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE lists FORCE ROW LEVEL SECURITY;
CREATE POLICY lists_tenant ON lists
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON lists TO stackup_app;
