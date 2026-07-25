-- 0042: Harden EVERY column the file-upload path touches.
--
-- 0040 re-created missing TABLES, but a drifted database can also have a
-- table that exists while missing individual COLUMNS — and then uploads keep
-- failing with an internal error even after the repair. This migration adds
-- every column the upload path reads or writes, idempotently, so no single
-- missing column can break attachments or document uploads again:
--
--   files            — the attachment/document row itself
--   task_activity    — the "attachment added" activity entry
--   workspace_limits — the storage-cap override table
--   workspaces.plan  — read by LimitsService to resolve the storage cap
--
-- Every statement is a no-op on a healthy database.

ALTER TABLE files ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES tasks (id) ON DELETE CASCADE;
ALTER TABLE files ADD COLUMN IF NOT EXISTS doc_id uuid REFERENCES docs (id) ON DELETE CASCADE;
ALTER TABLE files ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT 'file';
ALTER TABLE files ADD COLUMN IF NOT EXISTS mime text NOT NULL DEFAULT 'application/octet-stream';
ALTER TABLE files ADD COLUMN IF NOT EXISTS size_bytes int NOT NULL DEFAULT 0;
ALTER TABLE files ADD COLUMN IF NOT EXISTS is_clip boolean NOT NULL DEFAULT false;
ALTER TABLE files ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users (id);
ALTER TABLE files ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
-- `data` (bytea) has no sane default; add it nullable-then-not-null only when
-- the table somehow lacks it (an empty table can be fixed; a populated one
-- keeps its rows and the column is left alone).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'files' AND column_name = 'data'
  ) THEN
    ALTER TABLE files ADD COLUMN data bytea;
    UPDATE files SET data = ''::bytea WHERE data IS NULL;
    ALTER TABLE files ALTER COLUMN data SET NOT NULL;
  END IF;
END $$;

ALTER TABLE task_activity ADD COLUMN IF NOT EXISTS actor_user_id uuid REFERENCES users (id);
ALTER TABLE task_activity ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'updated';
ALTER TABLE task_activity ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE task_activity ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE workspace_limits ADD COLUMN IF NOT EXISTS storage_limit_bytes bigint;
ALTER TABLE workspace_limits ADD COLUMN IF NOT EXISTS automations_monthly_limit int;
ALTER TABLE workspace_limits ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- The plan column drives the storage cap; without it every upload 500s.
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free';

-- Re-assert the grants the runtime role needs on this path (harmless if held).
GRANT SELECT, INSERT, UPDATE, DELETE ON files TO stackup_app;
GRANT SELECT, INSERT ON task_activity TO stackup_app;
GRANT SELECT ON workspace_limits TO stackup_app;
GRANT SELECT (plan) ON workspaces TO stackup_app;
