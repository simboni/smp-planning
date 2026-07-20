import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { loadConfig } from "../config";

/** The identity Google asserts about a user after a successful sign-in. */
export interface GoogleProfile {
  /** Google's stable, unique subject id for the user. */
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

/**
 * Thin wrapper over Google's OAuth 2.0 endpoints, kept behind an injectable so
 * the whole SSO flow can be exercised in tests with a fake that returns a
 * known profile — no network, no real client credentials. In production it
 * performs the authorization-code exchange and fetches the userinfo. When the
 * client id/secret are unset the provider reports itself unconfigured and the
 * SSO endpoints stay disabled.
 */
@Injectable()
export class GoogleOAuthClient {
  private readonly config = loadConfig();

  configured(): boolean {
    return Boolean(
      this.config.googleClientId &&
        this.config.googleClientSecret &&
        this.config.oauthRedirectUri,
    );
  }

  private requireConfigured(): void {
    if (!this.configured()) {
      throw new ServiceUnavailableException("Google sign-in is not configured");
    }
  }

  /** The Google consent-screen URL to send the browser to. */
  authorizeUrl(state: string): string {
    this.requireConfigured();
    const params = new URLSearchParams({
      client_id: this.config.googleClientId,
      redirect_uri: this.config.oauthRedirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      access_type: "online",
      prompt: "select_account",
    });
    return `${AUTH_URL}?${params.toString()}`;
  }

  /** Exchange an authorization code for the user's verified Google profile. */
  async exchange(code: string): Promise<GoogleProfile> {
    this.requireConfigured();
    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.config.googleClientId,
        client_secret: this.config.googleClientSecret,
        redirect_uri: this.config.oauthRedirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) {
      throw new ServiceUnavailableException("Google token exchange failed");
    }
    const token = (await tokenRes.json()) as { access_token?: string };
    if (!token.access_token) {
      throw new ServiceUnavailableException("Google returned no access token");
    }
    const infoRes = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!infoRes.ok) {
      throw new ServiceUnavailableException("Google userinfo request failed");
    }
    const info = (await infoRes.json()) as {
      sub?: string;
      email?: string;
      email_verified?: boolean | string;
      name?: string;
      picture?: string;
    };
    if (!info.sub || !info.email) {
      throw new ServiceUnavailableException("Google profile was incomplete");
    }
    return {
      sub: info.sub,
      email: info.email,
      emailVerified: info.email_verified === true || info.email_verified === "true",
      name: info.name ?? null,
      picture: info.picture ?? null,
    };
  }
}
