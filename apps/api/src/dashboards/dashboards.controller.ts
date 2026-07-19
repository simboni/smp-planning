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
import {
  AuthedRequest,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  WorkspaceGuard,
} from "../auth/guards";
import { DashboardsService } from "./dashboards.service";

/**
 * Module 10: Dashboards & reporting cards. Workspace-wide and member-facing:
 * @Roles('member') on the class means GUESTS 403 ON EVERY ROUTE. Any member
 * can create; creator-or-admin edit rules and per-caller visibility of card
 * DATA live in the service.
 */
@Controller()
@UseGuards(JwtAuthGuard, WorkspaceGuard, RolesGuard)
@Roles("member")
export class DashboardsController {
  constructor(private readonly dashboards: DashboardsService) {}

  private ctx(req: AuthedRequest) {
    return [req.workspaceId!, req.userId!, req.role!] as const;
  }

  // --- Dashboards -----------------------------------------------------------

  @Get("dashboards")
  async listDashboards(@Req() req: AuthedRequest) {
    return {
      dashboards: await this.dashboards.listDashboards(
        req.workspaceId!,
        req.userId!,
      ),
    };
  }

  @Post("dashboards")
  async createDashboard(
    @Req() req: AuthedRequest,
    @Body() body: { name?: string },
  ) {
    return {
      dashboard: await this.dashboards.createDashboard(
        req.workspaceId!,
        req.userId!,
        body ?? {},
      ),
    };
  }

  @Get("dashboards/:id")
  async getDashboard(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.dashboards.getDashboard(req.workspaceId!, req.userId!, id);
  }

  @Patch("dashboards/:id")
  async updateDashboard(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { name?: string },
  ) {
    return {
      dashboard: await this.dashboards.updateDashboard(
        ...this.ctx(req),
        id,
        body ?? {},
      ),
    };
  }

  @Delete("dashboards/:id")
  @HttpCode(204)
  async deleteDashboard(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.dashboards.deleteDashboard(...this.ctx(req), id);
  }

  // --- Cards ----------------------------------------------------------------

  @Post("dashboards/:id/cards")
  async createCard(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) dashboardId: string,
    @Body()
    body: {
      kind?: string;
      title?: string;
      config?: Record<string, unknown>;
      width?: string;
    },
  ) {
    return {
      card: await this.dashboards.createCard(
        ...this.ctx(req),
        dashboardId,
        body ?? {},
      ),
    };
  }

  @Patch("cards/:id")
  async updateCard(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body()
    body: {
      title?: string;
      config?: Record<string, unknown>;
      width?: string;
      position?: number;
    },
  ) {
    return {
      card: await this.dashboards.updateCard(...this.ctx(req), id, body ?? {}),
    };
  }

  @Delete("cards/:id")
  @HttpCode(204)
  async deleteCard(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.dashboards.deleteCard(...this.ctx(req), id);
  }

  @Get("cards/:id/data")
  async cardData(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return { data: await this.dashboards.cardData(...this.ctx(req), id) };
  }
}
