/**
 * Point every test at the migrated test database and a fixed JWT secret
 * BEFORE any module (config, DbService) is imported and reads process.env.
 * This file is listed in setupFiles, which runs before the test modules.
 */
process.env.APP_DB_URL =
  "postgres://stackup_app:app_dev_pw@localhost:5432/stackup_test";
process.env.JWT_SECRET = "test-secret";
