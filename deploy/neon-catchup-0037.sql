-- ===========================================================================
-- StackUp — Neon catch-up for department kinds (schema 0037)
--
-- ONLY needed if ADMIN_DB_URL is still not set on the API host (auto-migrate
-- disabled). Paste into the Neon SQL editor as the OWNER role and Run.
-- Idempotent — running it twice is harmless.
-- ===========================================================================

ALTER TABLE departments ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'general';

INSERT INTO schema_migrations (filename) VALUES ('0037_department_kinds.sql')
ON CONFLICT DO NOTHING;
