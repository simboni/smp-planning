-- 0031: Let a whiteboard link to the work it belongs to.
--
-- Whiteboards already carry an optional space_id (which drives visibility /
-- permissions). This adds three more OPTIONAL cross-references so a board can
-- point at the Folder, List, or Task it was made for — a launch board tied to
-- its launch list, a design canvas tied to a task, etc. These are references
-- for discoverability and navigation only; they do NOT change a board's
-- permissions (space_id still governs that). All three are ON DELETE SET NULL
-- so deleting the linked entity just clears the link, never the board.
--
-- No new grant is needed: 0013 granted table-wide SELECT/INSERT/UPDATE/DELETE
-- on whiteboards to stackup_app, which covers new columns automatically.

ALTER TABLE whiteboards
  ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES folders (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS list_id   uuid REFERENCES lists (id)   ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS task_id   uuid REFERENCES tasks (id)   ON DELETE SET NULL;
