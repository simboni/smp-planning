import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { HierarchyService } from "../hierarchy/hierarchy.service";
import { TasksService } from "../tasks/tasks.service";
import { PatGuard, PatRequest } from "./pat.guard";

/**
 * Public REST API v1 (M15), authenticated by Personal Access Token. A thin,
 * stable surface over the same services the app uses, so every RLS and
 * permission guarantee is preserved. Read-scoped tokens are limited to GETs
 * by PatGuard. This is the documented integration entry point.
 */
@Controller("api/v1")
@UseGuards(PatGuard)
export class PublicApiController {
  constructor(
    private readonly hierarchy: HierarchyService,
    private readonly tasks: TasksService,
  ) {}

  private ctx(req: PatRequest) {
    return [req.workspaceId!, req.userId!, req.role!] as const;
  }

  @Get("me")
  me(@Req() req: PatRequest) {
    return {
      workspaceId: req.workspaceId,
      userId: req.userId,
      role: req.role,
      scope: req.patScope,
    };
  }

  @Get("spaces")
  async spaces(@Req() req: PatRequest) {
    return { spaces: await this.hierarchy.listSpaces(...this.ctx(req)) };
  }

  @Get("lists/:id/tasks")
  async listTasks(
    @Req() req: PatRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return { tasks: await this.tasks.listTasks(...this.ctx(req), id) };
  }

  @Get("tasks/:id")
  async getTask(
    @Req() req: PatRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return { task: await this.tasks.getTask(...this.ctx(req), id) };
  }

  @Post("lists/:id/tasks")
  async createTask(
    @Req() req: PatRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body()
    body: {
      name?: string;
      description?: string;
      priority?: string | null;
      dueDate?: string | null;
    },
  ) {
    return {
      task: await this.tasks.createTask(...this.ctx(req), id, body ?? {}),
    };
  }
}
