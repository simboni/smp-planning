-- 0013: Visual collaboration — files/attachments, whiteboards, mind maps,
-- proofing annotations. (Clips ride on files: a clip is a video attachment.)
--
-- Files are stored IN the database (bytea, 5MB cap enforced in the API).
-- Pragmatic for self-hosting: no external object store, RLS applies, backups
-- carry the data. Large-file offloading is a future adapter.

CREATE TABLE files (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  task_id      uuid REFERENCES tasks (id) ON DELETE CASCADE,  -- attachment home (nullable for future doc/chat files)
  name         text NOT NULL,
  mime         text NOT NULL,
  size_bytes   int NOT NULL CHECK (size_bytes >= 0),
  data         bytea NOT NULL,
  is_clip      boolean NOT NULL DEFAULT false,   -- screen recording
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX files_task_idx ON files (workspace_id, task_id, created_at);
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE files FORCE ROW LEVEL SECURITY;
CREATE POLICY files_tenant ON files
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON files TO stackup_app;

-- Whiteboards: elements live in one jsonb document
-- [{id,kind:'sticky'|'rect'|'ellipse'|'text'|'arrow',x,y,w,h,text,color,
--   points?:[{x,y}] (arrow), fontSize?}] — client-owned schema, size-capped.
CREATE TABLE whiteboards (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  space_id     uuid REFERENCES spaces (id) ON DELETE SET NULL,
  name         text NOT NULL,
  elements     jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_by   uuid REFERENCES users (id),
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whiteboards_workspace_idx ON whiteboards (workspace_id, updated_at DESC);
ALTER TABLE whiteboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboards FORCE ROW LEVEL SECURITY;
CREATE POLICY whiteboards_tenant ON whiteboards
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON whiteboards TO stackup_app;

-- Mind maps: a node tree in jsonb {id,text,children:[...],collapsed?}.
CREATE TABLE mindmaps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  space_id     uuid REFERENCES spaces (id) ON DELETE SET NULL,
  name         text NOT NULL,
  root         jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by   uuid REFERENCES users (id),
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mindmaps_workspace_idx ON mindmaps (workspace_id, updated_at DESC);
ALTER TABLE mindmaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE mindmaps FORCE ROW LEVEL SECURITY;
CREATE POLICY mindmaps_tenant ON mindmaps
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON mindmaps TO stackup_app;

-- Proofing: pinned annotations on an (image) file, each with its text.
-- x/y are 0..1 fractions of the rendered image.
CREATE TABLE proof_annotations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  file_id      uuid NOT NULL REFERENCES files (id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES users (id),
  x            numeric(6,5) NOT NULL CHECK (x >= 0 AND x <= 1),
  y            numeric(6,5) NOT NULL CHECK (y >= 0 AND y <= 1),
  body         text NOT NULL,
  resolved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX proof_annotations_file_idx ON proof_annotations (workspace_id, file_id, created_at);
ALTER TABLE proof_annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE proof_annotations FORCE ROW LEVEL SECURITY;
CREATE POLICY proof_annotations_tenant ON proof_annotations
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON proof_annotations TO stackup_app;
