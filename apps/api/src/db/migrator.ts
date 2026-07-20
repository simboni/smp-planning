import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Client } from "pg";

/**
 * Startup migrator (M22 fix). Applies db/migrations/*.sql in filename order,
 * each in its own transaction, recording applied files in schema_migrations —
 * so the deployed database is ALWAYS in sync with the code that ships with it.
 * This closes the recurring "internal server error after deploy" gap where a
 * new column/table referenced by the code didn't yet exist in the DB.
 *
 * Runs as the migrator role (ADMIN_DB_URL): DDL and table ownership require
 * it, and the runtime app role is deliberately DDL-less. When ADMIN_DB_URL is
 * absent, auto-migration is skipped (the app still boots) and the operator is
 * told how to enable it. SSL mirrors the app pool so managed hosts (Neon) work
 * without extra flags.
 */

/** SSL decision identical to the app pool, so Neon/managed hosts just work. */
function useSsl(connectionString: string): boolean {
  const forced = (process.env.DB_SSL ?? "").toLowerCase();
  if (["disable", "off", "false"].includes(forced)) return false;
  if (["require", "on", "true"].includes(forced)) return true;
  if (/sslmode=disable/i.test(connectionString)) return false;
  try {
    const host = new URL(connectionString).hostname;
    return !(host === "localhost" || host === "127.0.0.1" || host === "::1");
  } catch {
    return false;
  }
}

/** Locate db/migrations wherever the app is run from (repo, Docker image). */
function migrationsDir(): string | null {
  const candidates = [
    process.env.MIGRATIONS_DIR,
    join(process.cwd(), "db", "migrations"),
    join(process.cwd(), "..", "..", "db", "migrations"),
    resolve(__dirname, "..", "..", "..", "..", "db", "migrations"),
    resolve(__dirname, "..", "..", "..", "db", "migrations"),
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/**
 * Apply any pending migrations. Resolves quietly (never throws) so a migration
 * problem is logged but the API still starts — a half-migrated boot is better
 * diagnosed live than a crash loop, and truly-broken schema surfaces via the
 * failing query, not a dead process.
 */
export async function autoMigrate(): Promise<void> {
  const adminUrl = process.env.ADMIN_DB_URL;
  if (!adminUrl) {
    console.log(
      "[migrate] ADMIN_DB_URL not set — skipping auto-migration. " +
        "Set it (the stackup_migrator connection string) to apply schema on deploy.",
    );
    return;
  }
  const dir = migrationsDir();
  if (!dir) {
    console.warn("[migrate] could not locate db/migrations — skipping auto-migration.");
    return;
  }

  const client = new Client({
    connectionString: adminUrl,
    ssl: useSsl(adminUrl) ? { rejectUnauthorized: false } : undefined,
  });
  try {
    await client.connect();
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         filename text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    // Serialize concurrent boots (rolling deploy) so migrations apply once.
    await client.query("SELECT pg_advisory_lock(hashtext('schema_migrations'))");
    try {
      const applied = new Set(
        (await client.query("SELECT filename FROM schema_migrations")).rows.map(
          (r: { filename: string }) => r.filename,
        ),
      );
      // Baseline mode: an empty ledger against a database that already has the
      // core schema (e.g. bootstrapped by pasting SQL into a managed console).
      // Re-running early migrations there would fail on "already exists"; in
      // this mode only such duplicate-object errors are tolerated — the object
      // is recorded as applied and we move on — so genuinely-missing migrations
      // (the ones causing the post-deploy errors) still apply cleanly.
      const usersExists =
        (
          await client.query(
            "SELECT to_regclass('public.users') IS NOT NULL AS ok",
          )
        ).rows[0]?.ok === true;
      const baseline = applied.size === 0 && usersExists;
      if (baseline) {
        console.log(
          "[migrate] existing schema with empty ledger — baselining (tolerating already-applied objects).",
        );
      }
      // SQLSTATEs for "object already exists" (table/column/object/function/schema).
      const DUP = new Set(["42P07", "42701", "42710", "42723", "42P06", "42P16", "42704"]);

      const files = readdirSync(dir)
        .filter((f) => f.endsWith(".sql"))
        .sort();
      let count = 0;
      let baselined = 0;
      for (const file of files) {
        if (applied.has(file)) continue;
        const sql = readFileSync(join(dir, file), "utf8");
        await client.query("BEGIN");
        try {
          await client.query(sql);
          await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
          await client.query("COMMIT");
          console.log(`[migrate] applied ${file}`);
          count += 1;
        } catch (err) {
          await client.query("ROLLBACK").catch(() => undefined);
          const code = (err as { code?: string }).code;
          if (baseline && code && DUP.has(code)) {
            // Already present from the manual bootstrap — just record it.
            await client.query(
              "INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING",
              [file],
            );
            baselined += 1;
            continue;
          }
          throw new Error(`migration ${file} failed: ${(err as Error).message}`);
        }
      }
      if (baselined > 0) {
        console.log(`[migrate] baselined ${baselined} pre-existing migration(s).`);
      }
      console.log(
        count === 0 ? "[migrate] schema up to date." : `[migrate] applied ${count} migration(s).`,
      );
    } finally {
      await client
        .query("SELECT pg_advisory_unlock(hashtext('schema_migrations'))")
        .catch(() => undefined);
    }
  } catch (err) {
    console.error("[migrate] auto-migration error (continuing to boot):", (err as Error).message);
  } finally {
    await client.end().catch(() => undefined);
  }
}
