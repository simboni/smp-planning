import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { IdentityTokenClaims, WorkspaceTokenClaims } from "@stackup/shared";
import { AuthService } from "./auth.service";
import { CurrentAuth, JwtAuthGuard } from "./guards";

// Deliberately permissive email shape — the DB's unique index is the source
// of truth; this only rejects obviously malformed input early.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("signup")
  async signup(
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
    return this.auth.signup({ email, fullName, password });
  }

  @Post("login")
  @HttpCode(200)
  async login(@Body() body: { email?: string; password?: string }) {
    if (!body?.email || !body?.password) {
      throw new BadRequestException("Email and password are required");
    }
    return this.auth.login(body.email, body.password);
  }

  @Post("refresh")
  @HttpCode(200)
  async refresh(@Body() body: { refreshToken?: string }) {
    if (!body?.refreshToken) {
      throw new BadRequestException("refreshToken is required");
    }
    return this.auth.refresh(body.refreshToken);
  }

  /** Any valid token (identity or access) resolves to the same identity. */
  @Get("me")
  @UseGuards(JwtAuthGuard)
  async me(
    @CurrentAuth() auth: IdentityTokenClaims | WorkspaceTokenClaims,
  ) {
    return { user: await this.auth.me(auth.sub) };
  }
}
