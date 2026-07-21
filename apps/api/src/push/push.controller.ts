import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  Post,
  UseGuards,
} from "@nestjs/common";
import type {
  IdentityTokenClaims,
  WorkspaceTokenClaims,
} from "@stackup/shared";
import { CurrentAuth, JwtAuthGuard } from "../auth/guards";
import { PushService } from "./push.service";

/**
 * Device push-token registration. Tokens are identity-layer (a device belongs
 * to a user, not a workspace), so — like /auth/sessions — any valid token
 * (identity or access) may register/unregister the caller's own devices.
 */
@Controller("push")
@UseGuards(JwtAuthGuard)
export class PushController {
  constructor(private readonly push: PushService) {}

  @Post("tokens")
  async register(
    @CurrentAuth() auth: IdentityTokenClaims | WorkspaceTokenClaims,
    @Body() body: { token?: string; platform?: string },
  ) {
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!token) throw new BadRequestException("token is required");
    const platform =
      typeof body?.platform === "string" && body.platform.trim()
        ? body.platform.trim()
        : "android";
    await this.push.register(auth.sub, token, platform);
    return { ok: true };
  }

  @Delete("tokens")
  @HttpCode(204)
  async unregister(
    @CurrentAuth() auth: IdentityTokenClaims | WorkspaceTokenClaims,
    @Body() body: { token?: string },
  ) {
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!token) throw new BadRequestException("token is required");
    await this.push.unregister(auth.sub, token);
  }
}
