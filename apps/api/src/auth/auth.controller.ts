import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { IdentityTokenClaims, WorkspaceTokenClaims } from "@stackup/shared";
import { loadConfig } from "../config";
import { AuthService } from "./auth.service";
import { CurrentAuth, JwtAuthGuard } from "./guards";

// Deliberately permissive email shape — the DB's unique index is the source
// of truth; this only rejects obviously malformed input early.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

const ua = (req: Request) => req.headers["user-agent"];

@Controller("auth")
export class AuthController {
  private readonly config = loadConfig();
  constructor(private readonly auth: AuthService) {}

  /* ---- SSO (Module 18): Google OAuth ------------------------------- */

  /** Which SSO providers are configured — drives the login-page buttons. */
  @Get("sso/providers")
  ssoProviders() {
    return this.auth.ssoProviders();
  }

  /**
   * Redirect the browser to Google's consent screen. `?native=1` marks a flow
   * started from the installed Android app (it opens this URL in the system
   * browser — Google refuses OAuth inside WebViews), so the callback returns
   * tokens via the app's deep link instead of the website.
   */
  @Get("oauth/google/start")
  googleStart(@Res() res: Response, @Query("native") native?: string) {
    const { url } = this.auth.googleAuthUrl(native === "1");
    res.redirect(url);
  }

  /**
   * Google redirects here after consent. Exchange the code, mint tokens, and
   * bounce back with the tokens in the URL fragment (never sent to a server,
   * kept out of logs): to the SPA normally, or into the installed app via its
   * com.stackup.app:// deep link when the flow started there.
   */
  @Get("oauth/google/callback")
  async googleCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Query("code") code?: string,
    @Query("state") state?: string,
    @Query("error") error?: string,
  ) {
    const native = await this.auth.oauthStateIsNative(state ?? "");
    const target = (frag: string): string =>
      native
        ? `com.stackup.app://sso#${frag}`
        : `${this.config.webBaseUrl || ""}/login#${frag}`;
    if (error) {
      res.redirect(target(`sso_error=${encodeURIComponent(error)}`));
      return;
    }
    try {
      const result = await this.auth.googleCallback(code ?? "", state ?? "", ua(req));
      const frag = new URLSearchParams({
        sso: "google",
        identityToken: result.identityToken,
        refreshToken: result.refreshToken,
      });
      res.redirect(target(frag.toString()));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Sign-in failed";
      res.redirect(target(`sso_error=${encodeURIComponent(msg)}`));
    }
  }

  @Post("signup")
  async signup(
    @Req() req: Request,
    @Body()
    body: {
      email?: string;
      fullName?: string;
      password?: string;
    },
  ) {
    const { email, fullName, password } = body ?? {};
    if (!email || !EMAIL_RE.test(email)) {
      throw new BadRequestException("A valid email is required");
    }
    if (!fullName?.trim()) {
      throw new BadRequestException("Full name is required");
    }
    if (!password || password.length < MIN_PASSWORD) {
      throw new BadRequestException(
        `Password must be at least ${MIN_PASSWORD} characters`,
      );
    }
    return this.auth.signup({ email, fullName, password }, ua(req));
  }

  @Post("login")
  @HttpCode(200)
  async login(
    @Req() req: Request,
    @Body() body: { email?: string; password?: string },
  ) {
    if (!body?.email || !body?.password) {
      throw new BadRequestException("Email and password are required");
    }
    return this.auth.login(body.email, body.password, ua(req));
  }

  /** Second step of a 2FA login: exchange a challenge token + code for tokens. */
  @Post("2fa/login")
  @HttpCode(200)
  async login2fa(
    @Req() req: Request,
    @Body() body: { challengeToken?: string; code?: string },
  ) {
    if (!body?.challengeToken || !body?.code) {
      throw new BadRequestException("challengeToken and code are required");
    }
    return this.auth.login2fa(body.challengeToken, body.code, ua(req));
  }

  @Post("refresh")
  @HttpCode(200)
  async refresh(@Req() req: Request, @Body() body: { refreshToken?: string }) {
    if (!body?.refreshToken) {
      throw new BadRequestException("refreshToken is required");
    }
    return this.auth.refresh(body.refreshToken, ua(req));
  }

  /** Any valid token (identity or access) resolves to the same identity. */
  @Get("me")
  @UseGuards(JwtAuthGuard)
  async me(@CurrentAuth() auth: IdentityTokenClaims | WorkspaceTokenClaims) {
    return { user: await this.auth.me(auth.sub) };
  }

  /* ---- Two-factor auth (authenticated) ----------------------------- */

  @Get("2fa/status")
  @UseGuards(JwtAuthGuard)
  async twoFactorStatus(
    @CurrentAuth() auth: IdentityTokenClaims | WorkspaceTokenClaims,
  ) {
    return this.auth.twoFactorStatus(auth.sub);
  }

  @Post("2fa/enroll")
  @UseGuards(JwtAuthGuard)
  async enroll(@CurrentAuth() auth: IdentityTokenClaims | WorkspaceTokenClaims) {
    return this.auth.enroll2fa(auth.sub);
  }

  @Post("2fa/enable")
  @UseGuards(JwtAuthGuard)
  async enable(
    @CurrentAuth() auth: IdentityTokenClaims | WorkspaceTokenClaims,
    @Body() body: { code?: string },
  ) {
    if (!body?.code) throw new BadRequestException("A code is required");
    return this.auth.enable2fa(auth.sub, body.code);
  }

  @Post("2fa/disable")
  @UseGuards(JwtAuthGuard)
  async disable(
    @CurrentAuth() auth: IdentityTokenClaims | WorkspaceTokenClaims,
    @Body() body: { code?: string },
  ) {
    if (!body?.code) throw new BadRequestException("A code is required");
    return this.auth.disable2fa(auth.sub, body.code);
  }

  /* ---- Sessions (authenticated) ------------------------------------ */

  @Get("sessions")
  @UseGuards(JwtAuthGuard)
  async sessions(
    @Req() req: Request,
    @CurrentAuth() auth: IdentityTokenClaims | WorkspaceTokenClaims,
  ) {
    // The client sends its own refresh token so we can flag the current device.
    const current = req.headers["x-refresh-token"];
    return {
      sessions: await this.auth.listSessions(
        auth.sub,
        typeof current === "string" ? current : undefined,
      ),
    };
  }

  @Delete("sessions/:id")
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  async revokeSession(
    @CurrentAuth() auth: IdentityTokenClaims | WorkspaceTokenClaims,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.auth.revokeSession(auth.sub, id);
  }
}
