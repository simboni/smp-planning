-- 0008: Docs, wikis & Notepad.
--
-- A Doc is a container of nested Pages (parent_page_id tree). Docs live in
-- the workspace and may be attached to a Space (space_id) — attached docs
-- follow the space's permissions; unattached docs are workspace-wide, or
-- private to their creator (is_private). Page content is stored as HTML
-- produced by the editor (sanitized server-side).
--
-- Notepad: personal scratch notes (per user), convertible into tasks.

CREATE TABLE docs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  space_id     uuid REFERENCES spaces (id) ON DELETE SET NULL,
  name         text NOT NULL,
  icon         text NOT NULL DEFAULT '📄',
  is_private   boolean NOT NULL DEFAULT false,   -- creator-only when unattached
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX docs_workspace_idx ON docs (workspace_id, space_id);
ALTER TABLE docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE docs FORCE ROW LEVEL SECURITY;
CREATE POLICY docs_tenant ON docs
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON docs TO stackup_app;

CREATE TABLE doc_pages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  doc_id         uuid NOT NULL REFERENCES docs (id) ON DELETE CASCADE,
  parent_page_id uuid REFERENCES doc_pages (id) ON DELETE CASCADE,
  title          text NOT NULL DEFAULT 'Untitled',
  content        text NOT NULL DEFAULT '',
  position       int NOT NULL DEFAULT 0,
  updated_by     uuid REFERENCES users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX doc_pages_doc_idx ON doc_pages (workspace_id, doc_id, parent_page_id, position);
ALTER TABLE doc_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_pages FORCE ROW LEVEL SECURITY;
CREATE POLICY doc_pages_tenant ON doc_pages
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON doc_pages TO stackup_app;

CREATE TABLE notes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users (id),
  content      text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notes_user_idx ON notes (workspace_id, user_id, updated_at DESC);
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes FORCE ROW LEVEL SECURITY;
CREATE POLICY notes_tenant ON notes
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON notes TO stackup_app;
