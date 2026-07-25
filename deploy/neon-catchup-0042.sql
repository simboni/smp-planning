-- ===========================================================================
-- StackUp — harden EVERY column the upload path needs (schema 0042)
--
-- Run this if task attachments or document uploads STILL fail after the
-- 0040/0041 catch-up: that repair re-created missing TABLES, this one adds
-- missing COLUMNS (a table that exists but lacks a column keeps 500ing).
-- Paste into the Neon SQL editor as the OWNER role and Run. Idempotent.
-- ===========================================================================

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

INSERT INTO schema_migrations (filename) VALUES ('0042_harden_upload_path.sql')
ON CONFLICT DO NOTHING;
