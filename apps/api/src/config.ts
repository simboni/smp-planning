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
}
