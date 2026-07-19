import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthedRequest, JwtAuthGuard, WorkspaceGuard } from "../auth/guards";
import { TemplatesService } from "./templates.service";

/**
 * Module 14: Templates. Workspace-scoped; the service refuses guests and gates
 * each source/target by the owning space's permission.
 */
@Controller()
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  private ctx(req: AuthedRequest) {
    return [req.workspaceId!, req.userId!, req.role!] as const;
  }

  @Get("templates")
  async list(@Req() req: AuthedRequest, @Query("kind") kind?: string) {
    return { templates: await this.templates.list(...this.ctx(req), kind) };
  }

  @Post("templates/from/task/:id")
  async fromTask(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { name?: string; description?: string; icon?: string },
  ) {
    return {
      template: await this.templates.createFromTask(
        ...this.ctx(req),
        id,
        body ?? {},
      ),
    };
  }

  @Post("templates/from/list/:id")
  async fromList(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { name?: string; description?: string; icon?: string },
  ) {
    return {
      template: await this.templates.createFromList(
        ...this.ctx(req),
        id,
        body ?? {},
      ),
    };
  }

  @Post("templates/from/doc/:id")
  async fromDoc(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { name?: string; description?: string; icon?: string },
  ) {
    return {
      template: await this.templates.createFromDoc(
        ...this.ctx(req),
        id,
        body ?? {},
      ),
    };
  }

  @Post("templates/from/space/:id")
  async fromSpace(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { name?: string; description?: string; icon?: string },
  ) {
    return {
      template: await this.templates.createFromSpace(
        ...this.ctx(req),
        id,
        body ?? {},
      ),
    };
  }

  @Post("templates/:id/apply")
  @HttpCode(201)
  apply(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body()
    body: { targetListId?: string; targetSpaceId?: string; name?: string },
  ) {
    return this.templates.apply(...this.ctx(req), id, body ?? {});
  }

  @Patch("templates/:id")
  async update(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { name?: string; description?: string; icon?: string },
  ) {
    return { template: await this.templates.update(...this.ctx(req), id, body ?? {}) };
  }

  @Delete("templates/:id")
  @HttpCode(204)
  async remove(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.templates.remove(...this.ctx(req), id);
  }
}
