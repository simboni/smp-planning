/**
 * Environment configuration. Defaults target local development only;
 * production injects real values via the platform's secret manager.
 *
 * TTLs are seconds. The access-token TTL doubles as the identity-token TTL
 * (both are short-lived bearer JWTs); the refresh TTL governs the opaque,
 * hashed rotation tokens stored in the DB.
 */
export interface AppConfig {
  port: number;
  appDbUrl: string;
  jwtSecret: string;
  /** Access + identity JWT lifetime, in seconds. */
  accessTtl: number;
  /** Refresh-token lifetime, in seconds. */
  refreshTtl: number;
}

export function loadConfig(): AppConfig {
  return {
    port: Number(process.env.PORT ?? 3000),
    appDbUrl:
      process.env.APP_DB_URL ??
      "postgres://stackup_app:app_dev_pw@localhost:5432/stackup_dev",
    jwtSecret:
      process.env.JWT_SECRET ?? "dev-only-secret-do-not-use-in-production",
    accessTtl: Number(process.env.ACCESS_TOKEN_TTL ?? 900),
    refreshTtl: Number(process.env.REFRESH_TOKEN_TTL ?? 2592000),
  };
}
