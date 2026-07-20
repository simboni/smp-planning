import { Pool } from "pg";

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
 * non-local host and leave local development (localhost) plain, so the same
 * code works in both places with no extra env var. rejectUnauthorized is off
 * because managed endpoints (and their poolers) often present certs that don't
 * chain to the system CA store; the connection is still encrypted. Set
 * DB_SSL=disable to force it off, or DB_SSL=require to force it on.
 */
export function makePool(connectionString: string, max: number): Pool {
  const pool = new Pool({
    connectionString,
    max,
    keepAlive: true,
    ssl: useSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
  });
  pool.on("error", (err) => {
    console.warn(
      `pg pool: idle connection dropped (${err.message}) — continuing`,
    );
  });
  return pool;
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
