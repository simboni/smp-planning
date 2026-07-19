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
import {
  AuthedRequest,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  WorkspaceGuard,
} from "../auth/guards";
import { GoalsService } from "./goals.service";

/**
 * Module 9: Goals (OKRs) & Portfolios. Everything here is workspace-wide and
 * member-facing: @Roles('member') on the class means GUESTS 403 ON EVERY
 * ROUTE (goals/portfolios are internal planning surfaces), while members,
 * admins and owners pass. Finer edit/delete rules live in the service.
 */
@Controller()
@UseGuards(JwtAuthGuard, WorkspaceGuard, RolesGuard)
@Roles("member")
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  private ctx(req: AuthedRequest) {
    return [req.workspaceId!, req.userId!, req.role!] as const;
  }

  // --- Goal folders ---------------------------------------------------------

  @Get("goal-folders")
  async listFolders(@Req() req: AuthedRequest) {
    return {
      folders: await this.goals.listFolders(req.workspaceId!, req.userId!),
    };
  }

  @Post("goal-folders")
  async createFolder(
    @Req() req: AuthedRequest,
    @Body() body: { name?: string; color?: string },
  ) {
    return {
      folder: await this.goals.createFolder(
        req.workspaceId!,
        req.userId!,
        body ?? {},
      ),
    };
  }

  @Patch("goal-folders/:id")
  async updateFolder(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { name?: string; color?: string },
  ) {
    return {
      folder: await this.goals.updateFolder(
        req.workspaceId!,
        req.userId!,
        id,
        body ?? {},
      ),
    };
  }

  @Delete("goal-folders/:id")
  @HttpCode(204)
  async deleteFolder(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.goals.deleteFolder(req.workspaceId!, req.userId!, id);
  }

  // --- Goals ----------------------------------------------------------------

  @Get("goals")
  async listGoals(
    @Req() req: AuthedRequest,
    @Query("archived") archived?: string,
  ) {
    return {
      goals: await this.goals.listGoals(
        req.workspaceId!,
        req.userId!,
        archived === "1" || archived === "true",
      ),
    };
  }

  @Post("goals")
  async createGoal(
    @Req() req: AuthedRequest,
    @Body()
    body: {
      name?: string;
      description?: string;
      folderId?: string;
      ownerUserId?: string;
      dueDate?: string;
    },
  ) {
    return {
      goal: await this.goals.createGoal(
        req.workspaceId!,
        req.userId!,
        body ?? {},
      ),
    };
  }

  @Get("goals/:id")
  async getGoal(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return { goal: await this.goals.getGoal(...this.ctx(req), id) };
  }

  @Patch("goals/:id")
  async updateGoal(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body()
    body: {
      name?: string;
      description?: string;
      folderId?: string | null;
      ownerUserId?: string | null;
      dueDate?: string | null;
      archived?: boolean;
    },
  ) {
    return { goal: await this.goals.updateGoal(...this.ctx(req), id, body ?? {}) };
  }

  @Delete("goals/:id")
  @HttpCode(204)
  async deleteGoal(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.goals.deleteGoal(...this.ctx(req), id);
  }

  // --- Targets --------------------------------------------------------------

  @Post("goals/:id/targets")
  async createTarget(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) goalId: string,
    @Body()
    body: {
      name?: string;
      type?: string;
      startValue?: number;
      targetValue?: number;
      currency?: string;
      taskIds?: string[];
    },
  ) {
    return {
      target: await this.goals.createTarget(...this.ctx(req), goalId, body ?? {}),
    };
  }

  @Patch("targets/:id")
  async updateTarget(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body()
    body: {
      name?: string;
      startValue?: number;
      targetValue?: number;
      currentValue?: number;
      currency?: string;
      done?: boolean;
      taskIds?: string[];
    },
  ) {
    return {
      target: await this.goals.updateTarget(...this.ctx(req), id, body ?? {}),
    };
  }

  @Delete("targets/:id")
  @HttpCode(204)
  async deleteTarget(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.goals.deleteTarget(...this.ctx(req), id);
  }

  // --- Portfolios -----------------------------------------------------------

  @Get("portfolios")
  async listPortfolios(@Req() req: AuthedRequest) {
    return {
      portfolios: await this.goals.listPortfolios(req.workspaceId!, req.userId!),
    };
  }

  @Post("portfolios")
  async createPortfolio(
    @Req() req: AuthedRequest,
    @Body() body: { name?: string; color?: string; listIds?: string[] },
  ) {
    return {
      portfolio: await this.goals.createPortfolio(...this.ctx(req), body ?? {}),
    };
  }

  @Get("portfolios/:id")
  async getPortfolio(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.goals.getPortfolio(...this.ctx(req), id);
  }

  @Patch("portfolios/:id")
  async updatePortfolio(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { name?: string; color?: string; listIds?: string[] },
  ) {
    return {
      portfolio: await this.goals.updatePortfolio(...this.ctx(req), id, body ?? {}),
    };
  }

  @Delete("portfolios/:id")
  @HttpCode(204)
  async deletePortfolio(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.goals.deletePortfolio(...this.ctx(req), id);
  }
}
