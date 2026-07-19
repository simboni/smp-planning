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
import { AutomationsService } from "./automations.service";

/**
 * Module 11: Automations management (auth'd). No class-level role gate —
 * managing a rule requires edit permission on its SPACE, reading requires
 * the space to be visible (enforced in the service via AccessService).
 */
@Controller()
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class AutomationsController {
  constructor(private readonly automations: AutomationsService) {}

  private ctx(req: AuthedRequest) {
    return [req.workspaceId!, req.userId!, req.role!] as const;
  }

  @Get("spaces/:id/automations")
  async listAutomations(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) spaceId: string,
  ) {
    return {
      automations: await this.automations.listAutomations(
        ...this.ctx(req),
        spaceId,
      ),
    };
  }

  @Post("spaces/:id/automations")
  async createAutomation(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) spaceId: string,
    @Body()
    body: {
      name?: string;
      trigger?: unknown;
      actions?: unknown;
      enabled?: boolean;
    },
  ) {
    return {
      automation: await this.automations.createAutomation(
        ...this.ctx(req),
        spaceId,
        body ?? {},
      ),
    };
  }

  @Patch("automations/:id")
  async updateAutomation(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body()
    body: {
      name?: string;
      trigger?: unknown;
      actions?: unknown;
      enabled?: boolean;
    },
  ) {
    return {
      automation: await this.automations.updateAutomation(
        ...this.ctx(req),
        id,
        body ?? {},
      ),
    };
  }

  @Delete("automations/:id")
  @HttpCode(204)
  async deleteAutomation(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.automations.deleteAutomation(...this.ctx(req), id);
  }

  @Get("automations/:id/runs")
  async listRuns(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return { runs: await this.automations.listRuns(...this.ctx(req), id) };
  }
}
