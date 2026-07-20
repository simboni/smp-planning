import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthedRequest, JwtAuthGuard, WorkspaceGuard } from "../auth/guards";
import { PatService } from "./pat.service";

/**
 * Management of Personal Access Tokens (M15). Session-authenticated: a user
 * mints/lists/revokes tokens for the current workspace. The public API those
 * tokens unlock lives in PublicApiController (PAT-authenticated).
 */
@Controller("pat")
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class ApiTokensController {
  constructor(private readonly pat: PatService) {}

  @Get()
  async list(@Req() req: AuthedRequest) {
    return { tokens: await this.pat.list(req.workspaceId!, req.userId!) };
  }

  @Post()
  async create(
    @Req() req: AuthedRequest,
    @Body() body: { name?: string; scope?: string },
  ) {
    return this.pat.create(
      req.workspaceId!,
      req.userId!,
      req.role!,
      body ?? {},
    );
  }

  @Delete(":id")
  @HttpCode(204)
  async revoke(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.pat.revoke(req.workspaceId!, req.userId!, id);
  }
}
