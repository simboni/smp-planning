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
  /** Anthropic API key for the AI Brain; empty ⇒ heuristic fallback (M15). */
  anthropicApiKey: string;
  /** Claude model the AI Brain calls when a key is present. */
  aiModel: string;
  /** Google OAuth (M18). Client id/secret empty ⇒ SSO disabled (button hidden). */
  googleClientId: string;
  googleClientSecret: string;
  /** Absolute callback URL registered with Google, e.g. https://app/auth/oauth/google/callback. */
  oauthRedirectUri: string;
  /** Where the callback bounces the browser after minting tokens (defaults to same origin). */
  webBaseUrl: string;
  /** Email delivery (M22): "log" (default) or "http" (relay POST). */
  emailProvider: string;
  /** Relay endpoint for the http email provider; {to,subject,text} POSTed as JSON. */
  emailRelayUrl: string;
  /** Auth header VALUE sent to the relay (e.g. "Bearer re_..." for Resend). */
  emailRelayAuth: string;
  /** Auth header NAME (default Authorization; e.g. "api-key" for some providers). */
  emailRelayAuthHeader: string;
  /** From address stamped on outbound mail. */
  emailFrom: string;
}

/** The committed dev fallback — usable locally, never acceptable in prod. */
export const DEV_JWT_SECRET = "dev-only-secret-do-not-use-in-production";
const DEV_DB_URL = "postgres://stackup_app:app_dev_pw@localhost:5432/stackup_dev";

/**
 * Guard against booting production with a known/weak signing secret. A missing
 * or default JWT_SECRET means every token type is signed with a public
 * constant — anyone can forge an owner token. Fail fast instead of serving
 * forgeable auth. Only enforced when NODE_ENV=production so local/test runs
 * keep working with the dev default.
 */
function assertProductionSecrets(cfg: AppConfig): void {
  if (process.env.NODE_ENV !== "production") return;
  const problems: string[] = [];
  if (!process.env.JWT_SECRET || cfg.jwtSecret === DEV_JWT_SECRET) {
    problems.push("JWT_SECRET is unset or still the committed dev default");
  } else if (Buffer.byteLength(cfg.jwtSecret, "utf8") < 32) {
    problems.push("JWT_SECRET must be at least 32 bytes of entropy");
  }
  if (!process.env.APP_DB_URL || cfg.appDbUrl === DEV_DB_URL) {
    problems.push("APP_DB_URL is unset or still the local dev default");
  }
  if (problems.length > 0) {
    throw new Error(
      `Refusing to start in production with insecure config:\n  - ${problems.join(
        "\n  - ",
      )}`,
    );
  }
}

export function loadConfig(): AppConfig {
  const cfg: AppConfig = {
    port: Number(process.env.PORT ?? 3000),
    appDbUrl: process.env.APP_DB_URL ?? DEV_DB_URL,
    jwtSecret: process.env.JWT_SECRET ?? DEV_JWT_SECRET,
    accessTtl: Number(process.env.ACCESS_TOKEN_TTL ?? 900),
    refreshTtl: Number(process.env.REFRESH_TOKEN_TTL ?? 2592000),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
    aiModel: process.env.STACKUP_AI_MODEL ?? "claude-opus-4-8",
    googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    oauthRedirectUri: process.env.OAUTH_REDIRECT_URI ?? "",
    webBaseUrl: process.env.WEB_BASE_URL ?? "",
    emailProvider: process.env.EMAIL_PROVIDER ?? "log",
    emailRelayUrl: process.env.EMAIL_RELAY_URL ?? "",
    emailRelayAuth: process.env.EMAIL_RELAY_AUTH ?? "",
    emailRelayAuthHeader: process.env.EMAIL_RELAY_AUTH_HEADER ?? "Authorization",
    emailFrom: process.env.EMAIL_FROM ?? "no-reply@stackup.app",
  };
  assertProductionSecrets(cfg);
  return cfg;
}
