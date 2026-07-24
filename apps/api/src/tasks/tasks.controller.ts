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
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  AuthedRequest,
  JwtAuthGuard,
  WorkspaceGuard,
} from "../auth/guards";
import { ChecklistsService } from "./checklists.service";
import { FieldsService } from "./fields.service";
import { RelationsService } from "./relations.service";
import { StatusesService } from "./statuses.service";
import { TagsService } from "./tags.service";
import { TaskTypesService } from "./task-types.service";
import { TasksService } from "./tasks.service";

/**
 * Modules 3+4: Tasks Core plus custom fields, dependencies/links, task types
 * and recurrence. Every route is workspace-scoped (JwtAuthGuard +
 * WorkspaceGuard); intra-workspace permissions are enforced per-space inside
 * the services (404 when the owning space is not visible, 403 when the caller
 * lacks edit). workspaceId/userId/role always come from the access token.
 */
@Controller()
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly statuses: StatusesService,
    private readonly tags: TagsService,
    private readonly checklists: ChecklistsService,
    private readonly fields: FieldsService,
    private readonly relations: RelationsService,
    private readonly taskTypes: TaskTypesService,
  ) {}

  private ctx(req: AuthedRequest) {
    return [req.workspaceId!, req.userId!, req.role!] as const;
  }

  // --- Statuses -------------------------------------------------------------

  @Get("spaces/:id/statuses")
  async getStatuses(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) spaceId: string,
  ) {
    return { statuses: await this.statuses.getStatuses(...this.ctx(req), spaceId) };
  }

  @Post("spaces/:id/statuses")
  async createStatus(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) spaceId: string,
    @Body() body: { name?: string; color?: string; type?: string },
  ) {
    return {
      status: await this.statuses.create(...this.ctx(req), spaceId, body ?? {}),
    };
  }

  @Patch("statuses/:id")
  async updateStatus(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { name?: string; color?: string; type?: string },
  ) {
    return { status: await this.statuses.update(...this.ctx(req), id, body ?? {}) };
  }

  @Delete("statuses/:id")
  @HttpCode(204)
  async deleteStatus(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.statuses.remove(...this.ctx(req), id);
  }

  @Post("spaces/:id/statuses/reorder")
  @HttpCode(200)
  async reorderStatuses(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) spaceId: string,
    @Body() body: { ids?: string[] },
  ) {
    await this.statuses.reorder(...this.ctx(req), spaceId, body?.ids ?? []);
    return { ok: true };
  }

  // --- Tags -----------------------------------------------------------------

  @Get("spaces/:id/tags")
  async getTags(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) spaceId: string,
  ) {
    return { tags: await this.tags.getTags(...this.ctx(req), spaceId) };
  }

  @Post("spaces/:id/tags")
  async createTag(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) spaceId: string,
    @Body() body: { name?: string; color?: string },
  ) {
    return { tag: await this.tags.create(...this.ctx(req), spaceId, body ?? {}) };
  }

  @Patch("tags/:id")
  async updateTag(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { name?: string; color?: string },
  ) {
    return { tag: await this.tags.update(...this.ctx(req), id, body ?? {}) };
  }

  @Delete("tags/:id")
  @HttpCode(204)
  async deleteTag(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.tags.remove(...this.ctx(req), id);
  }

  // --- Tasks ----------------------------------------------------------------

  @Get("lists/:id/tasks")
  async listTasks(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) listId: string,
  ) {
    return { tasks: await this.tasks.listTasks(...this.ctx(req), listId) };
  }

  @Post("lists/:id/tasks")
  async createTask(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) listId: string,
    @Body()
    body: {
      name?: string;
      statusId?: string;
      priority?: string | null;
      assigneeIds?: string[];
      tagIds?: string[];
      startDate?: string | null;
      dueDate?: string | null;
      timeEstimateMinutes?: number | null;
      description?: string;
      parentTaskId?: string | null;
    },
  ) {
    return {
      task: await this.tasks.createTask(...this.ctx(req), listId, body ?? {}),
    };
  }

  @Post("lists/:id/tasks/reorder")
  @HttpCode(200)
  async reorderTasks(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) listId: string,
    @Body() body: { statusId?: string; ids?: string[] },
  ) {
    await this.tasks.reorderTasks(
      ...this.ctx(req),
      listId,
      body?.statusId ?? "",
      body?.ids ?? [],
    );
    return { ok: true };
  }

  @Get("tasks/:id")
  async getTask(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return { task: await this.tasks.getTask(...this.ctx(req), id) };
  }

  @Patch("tasks/:id")
  async updateTask(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body()
    body: {
      name?: string;
      description?: string;
      statusId?: string;
      priority?: string | null;
      startDate?: string | null;
      dueDate?: string | null;
      timeEstimateMinutes?: number | null;
      archived?: boolean;
      taskTypeId?: string | null;
      isMilestone?: boolean;
      recurrence?: Record<string, unknown> | null;
      sprintPoints?: number | null;
      listId?: string;
    },
  ) {
    return { task: await this.tasks.updateTask(...this.ctx(req), id, body ?? {}) };
  }

  @Delete("tasks/:id")
  @HttpCode(204)
  async deleteTask(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.tasks.deleteTask(...this.ctx(req), id);
  }

  @Get("tasks/:id/activity")
  async getActivity(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return { activity: await this.tasks.listActivity(...this.ctx(req), id) };
  }

  @Post("tasks/:id/subtasks")
  async createSubtask(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { name?: string },
  ) {
    return { task: await this.tasks.createSubtask(...this.ctx(req), id, body ?? {}) };
  }

  // --- Assignees ------------------------------------------------------------

  @Post("tasks/:id/assignees")
  @HttpCode(201)
  async addAssignee(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { userId?: string },
  ) {
    await this.tasks.addAssignee(...this.ctx(req), id, body?.userId ?? "");
    return { ok: true };
  }

  @Delete("tasks/:id/assignees/:userId")
  @HttpCode(204)
  async removeAssignee(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("userId", ParseUUIDPipe) userId: string,
  ) {
    await this.tasks.removeAssignee(...this.ctx(req), id, userId);
  }

  // --- Watchers -------------------------------------------------------------

  @Post("tasks/:id/watchers")
  @HttpCode(201)
  async addWatcher(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { userId?: string },
  ) {
    await this.tasks.addWatcher(...this.ctx(req), id, body?.userId ?? "");
    return { ok: true };
  }

  @Delete("tasks/:id/watchers/:userId")
  @HttpCode(204)
  async removeWatcher(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("userId", ParseUUIDPipe) userId: string,
  ) {
    await this.tasks.removeWatcher(...this.ctx(req), id, userId);
  }

  // --- Task tags ------------------------------------------------------------

  @Post("tasks/:id/tags")
  @HttpCode(201)
  async addTag(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { tagId?: string; name?: string; color?: string },
  ) {
    return { tag: await this.tasks.addTag(...this.ctx(req), id, body ?? {}) };
  }

  @Delete("tasks/:id/tags/:tagId")
  @HttpCode(204)
  async removeTag(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("tagId", ParseUUIDPipe) tagId: string,
  ) {
    await this.tasks.removeTag(...this.ctx(req), id, tagId);
  }

  // --- Checklists -----------------------------------------------------------

  @Post("tasks/:id/checklists")
  async createChecklist(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { name?: string },
  ) {
    return {
      checklist: await this.checklists.createChecklist(
        ...this.ctx(req),
        id,
        body ?? {},
      ),
    };
  }

  @Patch("checklists/:id")
  async updateChecklist(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { name?: string },
  ) {
    return {
      checklist: await this.checklists.updateChecklist(
        ...this.ctx(req),
        id,
        body ?? {},
      ),
    };
  }

  @Delete("checklists/:id")
  @HttpCode(204)
  async deleteChecklist(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.checklists.removeChecklist(...this.ctx(req), id);
  }

  @Post("checklists/:id/items")
  async createItem(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { name?: string },
  ) {
    return {
      item: await this.checklists.createItem(...this.ctx(req), id, body ?? {}),
    };
  }

  @Patch("checklist-items/:id")
  async updateItem(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body()
    body: { name?: string; resolved?: boolean; assigneeUserId?: string | null },
  ) {
    return {
      item: await this.checklists.updateItem(...this.ctx(req), id, body ?? {}),
    };
  }

  @Delete("checklist-items/:id")
  @HttpCode(204)
  async deleteItem(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.checklists.removeItem(...this.ctx(req), id);
  }

  // --- Custom fields (M4) ---------------------------------------------------

  @Get("spaces/:id/fields")
  async getFields(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) spaceId: string,
  ) {
    return { fields: await this.fields.listFields(...this.ctx(req), spaceId) };
  }

  @Post("spaces/:id/fields")
  async createField(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) spaceId: string,
    @Body() body: { name?: string; type?: string; config?: unknown },
  ) {
    return {
      field: await this.fields.create(...this.ctx(req), spaceId, body ?? {}),
    };
  }

  @Patch("fields/:id")
  async updateField(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { name?: string; config?: unknown; position?: number },
  ) {
    return { field: await this.fields.update(...this.ctx(req), id, body ?? {}) };
  }

  @Delete("fields/:id")
  @HttpCode(204)
  async deleteField(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.fields.remove(...this.ctx(req), id);
  }

  @Put("tasks/:id/fields/:fieldId")
  async setFieldValue(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("fieldId", ParseUUIDPipe) fieldId: string,
    @Body() body: { value?: unknown },
  ) {
    return this.fields.setValue(
      ...this.ctx(req),
      id,
      fieldId,
      body?.value ?? null,
    );
  }

  // --- Dependencies & links (M4) --------------------------------------------

  @Post("tasks/:id/dependencies")
  @HttpCode(201)
  async addDependency(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { dependsOnTaskId?: string },
  ) {
    await this.relations.addDependency(
      ...this.ctx(req),
      id,
      body?.dependsOnTaskId,
    );
    return { ok: true };
  }

  @Delete("tasks/:id/dependencies/:dependsOnTaskId")
  @HttpCode(204)
  async removeDependency(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("dependsOnTaskId", ParseUUIDPipe) dependsOnTaskId: string,
  ) {
    await this.relations.removeDependency(...this.ctx(req), id, dependsOnTaskId);
  }

  @Post("tasks/:id/links")
  @HttpCode(201)
  async addLink(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { taskId?: string },
  ) {
    await this.relations.addLink(...this.ctx(req), id, body?.taskId);
    return { ok: true };
  }

  @Delete("tasks/:id/links/:taskId")
  @HttpCode(204)
  async removeLink(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("taskId", ParseUUIDPipe) taskId: string,
  ) {
    await this.relations.removeLink(...this.ctx(req), id, taskId);
  }

  // --- Task types (M4) ------------------------------------------------------

  @Get("spaces/:id/task-types")
  async getTaskTypes(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) spaceId: string,
  ) {
    return {
      taskTypes: await this.taskTypes.listTaskTypes(...this.ctx(req), spaceId),
    };
  }

  @Post("spaces/:id/task-types")
  async createTaskType(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) spaceId: string,
    @Body() body: { name?: string; icon?: string; isMilestone?: boolean },
  ) {
    return {
      taskType: await this.taskTypes.create(
        ...this.ctx(req),
        spaceId,
        body ?? {},
      ),
    };
  }

  @Patch("task-types/:id")
  async updateTaskType(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { name?: string; icon?: string; isMilestone?: boolean },
  ) {
    return {
      taskType: await this.taskTypes.update(...this.ctx(req), id, body ?? {}),
    };
  }

  @Delete("task-types/:id")
  @HttpCode(204)
  async deleteTaskType(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.taskTypes.remove(...this.ctx(req), id);
  }
}
