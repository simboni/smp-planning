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
  WorkspaceGuard,
} from "../auth/guards";
import { CommentsService } from "./comments.service";

/**
 * Module 6: threaded task comments. Workspace-scoped like every task route;
 * per-space permissions live in the service (visible to read, >= 'comment'
 * to write, author-or-admin to delete).
 */
@Controller()
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  private ctx(req: AuthedRequest) {
    return [req.workspaceId!, req.userId!, req.role!] as const;
  }

  @Get("tasks/:id/comments")
  async listComments(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) taskId: string,
  ) {
    return {
      comments: await this.comments.listComments(...this.ctx(req), taskId),
    };
  }

  @Post("tasks/:id/comments")
  async createComment(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) taskId: string,
    @Body()
    body: { body?: string; parentCommentId?: string; assigneeUserId?: string },
  ) {
    return {
      comment: await this.comments.createComment(
        ...this.ctx(req),
        taskId,
        body ?? {},
      ),
    };
  }

  @Patch("comments/:id")
  async updateComment(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body()
    body: { body?: string; assigneeUserId?: string | null; resolved?: boolean },
  ) {
    return {
      comment: await this.comments.updateComment(
        ...this.ctx(req),
        id,
        body ?? {},
      ),
    };
  }

  @Delete("comments/:id")
  @HttpCode(204)
  async deleteComment(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.comments.deleteComment(...this.ctx(req), id);
  }
}
