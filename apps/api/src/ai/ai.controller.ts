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
import {
  AiBuilderService,
  type BuildPlan,
  type FormPlan,
  type ListRef,
  type SpaceRef,
} from "./ai-builder.service";
import { AiAskService } from "./ai-ask.service";

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
    private readonly askService: AiAskService,
  ) {}

  @Get("status")
  status() {
    return this.ai.status();
  }

  /** Answer a natural-language question grounded in the workspace. */
  @Post("ask")
  async ask(@Req() req: AuthedRequest, @Body() body: { question?: string }) {
    if (!body.question || !body.question.trim()) {
      throw new BadRequestException("question is required");
    }
    return this.askService.ask(
      req.workspaceId!,
      req.userId!,
      req.role!,
      body.question,
    );
  }

  /** Turn a natural-language brief into a placement-aware preview plan. */
  @Post("build/plan")
  async buildPlan(@Req() req: AuthedRequest, @Body() body: { prompt?: string }) {
    if (!body.prompt || !body.prompt.trim()) {
      throw new BadRequestException("prompt is required");
    }
    return this.builder.plan(
      req.workspaceId!,
      req.userId!,
      req.role!,
      body.prompt,
    );
  }

  /** Editable spaces + lists the caller can build into (for the picker). */
  @Get("build/context")
  async buildContext(@Req() req: AuthedRequest) {
    return this.builder.context(req.workspaceId!, req.userId!, req.role!);
  }

  /** Execute a (previewed, possibly edited) plan against the real services. */
  @Post("build")
  async build(
    @Req() req: AuthedRequest,
    @Body() body: { plan?: BuildPlan },
  ) {
    if (
      !body.plan ||
      !Array.isArray(body.plan.targets) ||
      body.plan.targets.length === 0
    ) {
      throw new BadRequestException("A plan with at least one target is required");
    }
    return this.builder.build(
      req.workspaceId!,
      req.userId!,
      req.role!,
      body.plan,
    );
  }

  /** Draft a form from a brief (no writes). */
  @Post("form/plan")
  async formPlan(@Body() body: { prompt?: string }) {
    if (!body.prompt || !body.prompt.trim()) {
      throw new BadRequestException("prompt is required");
    }
    return this.builder.planForm(body.prompt);
  }

  /** Create a (previewed) form into a chosen/created destination list. */
  @Post("form")
  async formBuild(
    @Req() req: AuthedRequest,
    @Body() body: { form?: FormPlan; space?: SpaceRef; list?: ListRef },
  ) {
    if (!body.form || !Array.isArray(body.form.fields) || body.form.fields.length === 0) {
      throw new BadRequestException("A form with at least one field is required");
    }
    if (!body.space || !body.list) {
      throw new BadRequestException("A destination space and list are required");
    }
    return this.builder.buildForm(
      req.workspaceId!,
      req.userId!,
      req.role!,
      body.form,
      body.space,
      body.list,
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
