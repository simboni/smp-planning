import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthedRequest, JwtAuthGuard, WorkspaceGuard } from "../auth/guards";
import { AiService, WriteAction } from "./ai.service";

const WRITE_ACTIONS: WriteAction[] = [
  "improve",
  "expand",
  "shorten",
  "fix",
  "draft",
];

/**
 * Module 15 — AI Brain. Workspace-scoped; guests included (read-oriented
 * assistance). Every endpoint returns text plus a `source` flag so the UI can
 * badge heuristic output when no model key is configured.
 */
@Controller("ai")
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get("status")
  status() {
    return this.ai.status();
  }

  @Post("write")
  async write(
    @Body() body: { action?: string; text?: string; tone?: string },
  ) {
    const action = body.action as WriteAction;
    if (!WRITE_ACTIONS.includes(action)) {
      throw new BadRequestException("Unknown write action");
    }
    if (!body.text || !body.text.trim()) {
      throw new BadRequestException("text is required");
    }
    return this.ai.write(action, body.text, body.tone);
  }

  @Post("summarize")
  async summarize(@Body() body: { text?: string }) {
    if (!body.text || !body.text.trim()) {
      throw new BadRequestException("text is required");
    }
    return this.ai.summarize(body.text);
  }

  @Post("tasks/:id/summary")
  async taskSummary(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.ai.taskSummary(req.workspaceId!, req.userId!, id);
  }

  @Post("tasks/:id/subtasks")
  async taskSubtasks(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.ai.subtasks(req.workspaceId!, req.userId!, { taskId: id });
  }

  @Post("subtasks")
  async subtasks(@Req() req: AuthedRequest, @Body() body: { prompt?: string }) {
    if (!body.prompt || !body.prompt.trim()) {
      throw new BadRequestException("prompt is required");
    }
    return this.ai.subtasks(req.workspaceId!, req.userId!, {
      prompt: body.prompt,
    });
  }

  @Post("command")
  async command(@Body() body: { text?: string }) {
    if (!body.text || !body.text.trim()) {
      throw new BadRequestException("text is required");
    }
    return { command: await this.ai.command(body.text) };
  }
}
