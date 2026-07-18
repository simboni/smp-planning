-- One-time cluster bootstrap. Run as a superuser BEFORE migrations:
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -f db/bootstrap.sql
--
-- Two-role model:
--   stackup_migrator — owns the schema; used ONLY by the migration runner.
--   stackup_app      — runtime role; NOBYPASSRLS, never owns tables, so
--                      FORCE ROW LEVEL SECURITY applies to every query it runs.
-- Passwords here are local-development values; real environments inject them
-- via secret management.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stackup_migrator') THEN
    CREATE ROLE stackup_migrator LOGIN PASSWORD 'migrator_dev_pw';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stackup_app') THEN
    CREATE ROLE stackup_app LOGIN PASSWORD 'app_dev_pw' NOBYPASSRLS;
  END IF;
END
$$;

-- Role attributes (idempotent). The migrator owns the schema and is the
-- definer of the workspace-provisioning function; BYPASSRLS lets that trusted,
-- admin-only path insert the first workspace row. The runtime role NEVER
-- bypasses RLS, so every tenant query it runs is policy-bound.
ALTER ROLE stackup_migrator BYPASSRLS;
ALTER ROLE stackup_app NOBYPASSRLS;

SELECT 'CREATE DATABASE stackup_dev OWNER stackup_migrator'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'stackup_dev')
\gexec

SELECT 'CREATE DATABASE stackup_test OWNER stackup_migrator'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'stackup_test')
\gexec
