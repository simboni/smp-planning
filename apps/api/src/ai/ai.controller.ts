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
import { AiBuilderService, type BuildPlan } from "./ai-builder.service";

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
  constructor(
    private readonly ai: AiService,
    private readonly builder: AiBuilderService,
  ) {}

  @Get("status")
  status() {
    return this.ai.status();
  }

  /** Turn a natural-language brief into a preview plan (no writes). */
  @Post("build/plan")
  async buildPlan(@Body() body: { prompt?: string }) {
    if (!body.prompt || !body.prompt.trim()) {
      throw new BadRequestException("prompt is required");
    }
    return this.builder.plan(body.prompt);
  }

  /** Execute a (previewed, possibly edited) plan against the real services. */
  @Post("build")
  async build(
    @Req() req: AuthedRequest,
    @Body() body: { plan?: BuildPlan },
  ) {
    if (!body.plan || !Array.isArray(body.plan.spaces) || body.plan.spaces.length === 0) {
      throw new BadRequestException("A plan with at least one space is required");
    }
    return this.builder.build(
      req.workspaceId!,
      req.userId!,
      req.role!,
      body.plan,
    );
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
