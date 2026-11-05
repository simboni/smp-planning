-- 0044: A doc remembers the folder or list it was created in.
--
-- Docs only had space_id, so "New doc" from a folder's or a list's menu put
-- the doc at the top of the space and the folder/list was forgotten — the
-- doc could not be found where it was made. Now a doc can sit at any level:
--
--   space_id only                      top of the space
--   space_id + folder_id               in a folder
--   space_id + folder_id? + list_id    in a list (folder_id = the list's)
--
-- space_id stays the access boundary (docs follow their space's grants);
-- folder_id / list_id only say where in the space the doc lives. Deleting
-- the folder or list does not delete its docs: they fall back to the space
-- (ON DELETE SET NULL). Moving a list or folder takes its docs along
-- (triggers below), so the three columns never disagree.

ALTER TABLE docs
  ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES folders (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS list_id   uuid REFERENCES lists (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS docs_location_idx
  ON docs (workspace_id, space_id, folder_id, list_id);

-- A list moved to another folder or space carries its docs.
CREATE OR REPLACE FUNCTION docs_follow_list() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.space_id IS DISTINCT FROM OLD.space_id
     OR NEW.folder_id IS DISTINCT FROM OLD.folder_id THEN
    UPDATE docs SET space_id = NEW.space_id, folder_id = NEW.folder_id
     WHERE list_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS docs_follow_list ON lists;
CREATE TRIGGER docs_follow_list AFTER UPDATE OF space_id, folder_id ON lists
  FOR EACH ROW EXECUTE FUNCTION docs_follow_list();

-- A folder moved to another space carries its docs (and its lists' docs).
CREATE OR REPLACE FUNCTION docs_follow_folder() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.space_id IS DISTINCT FROM OLD.space_id THEN
    UPDATE docs SET space_id = NEW.space_id WHERE folder_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS docs_follow_folder ON folders;
CREATE TRIGGER docs_follow_folder AFTER UPDATE OF space_id ON folders
  FOR EACH ROW EXECUTE FUNCTION docs_follow_folder();
