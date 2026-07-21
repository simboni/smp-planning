import { readFileSync } from "node:fs";
import { Pool } from "pg";
import type { PoolConfig } from "pg";

/**
 * All pg pools MUST be created through here. node-postgres emits 'error'
 * on the pool when an idle client's connection is dropped (managed
 * databases and their proxies do this routinely); with no listener that
 * event crashes the entire process. The client is already discarded by
 * the pool — logging is the only correct action.
 *
 * TLS: managed providers (Neon, Supabase, RDS) REQUIRE SSL and refuse plain
 * connections — without this, the app boots and serves static pages but every
 * DB query (e.g. signup) fails with a 500. We enable SSL automatically for any
 * non-local host and leave local development (localhost) plain.
 *
 * The certificate IS verified by default (rejectUnauthorized: true) so the DB
 * connection can't be silently MITM'd. Most managed providers (incl. Neon)
 * present certs that chain to a public CA in Node's trust store, so this works
 * out of the box. If your provider uses a private CA, set DB_SSL_CA to the CA
 * PEM (inline or a file path). As a last-resort escape hatch, DB_SSL_INSECURE=1
 * disables verification (encrypted but unauthenticated) — avoid in production.
 * DB_SSL=disable forces plaintext; DB_SSL=require forces TLS on.
 */
export function makePool(connectionString: string, max: number): Pool {
  const pool = new Pool({
    connectionString,
    max,
    keepAlive: true,
    ssl: sslConfig(connectionString),
  });
  pool.on("error", (err) => {
    console.warn(
      `pg pool: idle connection dropped (${err.message}) — continuing`,
    );
  });
  return pool;
}

/**
 * Build the pg `ssl` option: undefined (plaintext) for local, otherwise a
 * verifying TLS config with an optional custom CA and an opt-out escape hatch.
 * Exported for the migrator so both connections share one TLS policy.
 */
export function sslConfig(connectionString: string): PoolConfig["ssl"] {
  if (!useSsl(connectionString)) return undefined;
  const insecure = /^(1|true|yes)$/i.test(process.env.DB_SSL_INSECURE ?? "");
  if (insecure) return { rejectUnauthorized: false };
  const ca = loadCa();
  return ca
    ? { rejectUnauthorized: true, ca }
    : { rejectUnauthorized: true };
}

/** Read DB_SSL_CA as inline PEM or a file path, if provided. */
function loadCa(): string | undefined {
  const raw = (process.env.DB_SSL_CA ?? "").trim();
  if (!raw) return undefined;
  if (raw.includes("BEGIN CERTIFICATE")) return raw;
  try {
    return readFileSync(raw, "utf8");
  } catch {
    console.warn(`DB_SSL_CA path unreadable (${raw}) — using system CAs`);
    return undefined;
  }
}

/** Decide whether to negotiate TLS for this connection string. */
function useSsl(connectionString: string): boolean {
  const forced = (process.env.DB_SSL ?? "").toLowerCase();
  if (forced === "disable" || forced === "off" || forced === "false") {
    return false;
  }
  if (forced === "require" || forced === "on" || forced === "true") {
    return true;
  }
  if (/sslmode=disable/i.test(connectionString)) return false;
  try {
    const host = new URL(connectionString).hostname;
    return !(host === "localhost" || host === "127.0.0.1" || host === "::1");
  } catch {
    // Unparseable string — default to no SSL (local-style).
    return false;
  }
}
