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
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthedRequest, JwtAuthGuard, WorkspaceGuard } from "../auth/guards";
import { SprintsService } from "./sprints.service";

/**
 * Module 10: Sprints. No class-level role gate — access rides on the SPACE:
 * creating/updating/deleting a sprint requires edit permission on its space,
 * reading requires the space to be visible (both enforced in the service via
 * AccessService, so even a guest with an edit share can run their sprints).
 */
@Controller()
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class SprintsController {
  constructor(private readonly sprints: SprintsService) {}

  private ctx(req: AuthedRequest) {
    return [req.workspaceId!, req.userId!, req.role!] as const;
  }

  @Post("spaces/:id/sprints")
  async createSprint(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) spaceId: string,
    @Body() body: { name?: string; startDate?: string; endDate?: string },
  ) {
    return {
      sprint: await this.sprints.createSprint(
        ...this.ctx(req),
        spaceId,
        body ?? {},
      ),
    };
  }

  @Get("spaces/:id/sprints")
  async listSprints(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) spaceId: string,
  ) {
    return { sprints: await this.sprints.listSprints(...this.ctx(req), spaceId) };
  }

  @Patch("sprints/:id")
  async updateSprint(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body()
    body: {
      name?: string;
      startDate?: string;
      endDate?: string;
      archived?: boolean;
    },
  ) {
    return {
      sprint: await this.sprints.updateSprint(...this.ctx(req), id, body ?? {}),
    };
  }

  @Delete("sprints/:id")
  @HttpCode(204)
  async deleteSprint(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.sprints.deleteSprint(...this.ctx(req), id);
  }

  @Get("sprints/:id/report")
  async report(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.sprints.report(...this.ctx(req), id);
  }
}
