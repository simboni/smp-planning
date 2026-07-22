-- 0034: Guarantee the whiteboard link columns exist on every database.
--
-- The whiteboards query (WB_SELECT) references folder_id / list_id / task_id
-- added in 0031. On a drifted live database the migrator had stopped before
-- 0031, so those columns were missing and EVERY whiteboard request 500'd. The
-- resilient migrator now keeps applying past a stuck file, but to make the fix
-- deploy-guaranteed (independent of 0031's recorded state) this re-asserts the
-- columns idempotently as a fresh, always-pending repair. No-op where present.

ALTER TABLE whiteboards
  ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES folders (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS list_id   uuid REFERENCES lists (id)   ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS task_id   uuid REFERENCES tasks (id)   ON DELETE SET NULL;
