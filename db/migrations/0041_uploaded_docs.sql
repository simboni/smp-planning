-- 0041: Uploaded documents (PDF / Word / any file as a first-class Doc).
--
-- An uploaded document IS a doc: a `docs` row whose content is a stored file
-- instead of editable pages. The file row points at its doc (files.doc_id),
-- so the upload inherits everything docs already solved — space attachment
-- (incl. department home spaces), privacy, guest rules, the Docs grid,
-- name search — and the storage meter keeps working because the bytes still
-- live in `files`. One file per doc, enforced by a partial unique index.
ALTER TABLE files ADD COLUMN IF NOT EXISTS doc_id uuid REFERENCES docs (id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS files_doc_unique_idx
  ON files (doc_id) WHERE doc_id IS NOT NULL;
