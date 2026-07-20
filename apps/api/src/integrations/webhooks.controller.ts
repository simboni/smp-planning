import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthedRequest, JwtAuthGuard, WorkspaceGuard } from "../auth/guards";
import { WebhooksService } from "./webhooks.service";

/**
 * Webhook management (M15). Session-authenticated. Creating a webhook returns
 * its signing secret once; deliveries are HMAC-signed with it.
 */
@Controller("webhooks")
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  async list(@Req() req: AuthedRequest) {
    return { webhooks: await this.webhooks.list(req.workspaceId!, req.userId!) };
  }

  @Post()
  async create(
    @Req() req: AuthedRequest,
    @Body() body: { url?: string; events?: string[] },
  ) {
    return this.webhooks.create(
      req.workspaceId!,
      req.userId!,
      req.role!,
      body ?? {},
    );
  }

  @Get(":id/deliveries")
  async deliveries(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return {
      deliveries: await this.webhooks.deliveries(
        req.workspaceId!,
        req.userId!,
        id,
      ),
    };
  }

  @Post(":id/test")
  async test(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.webhooks.test(req.workspaceId!, req.userId!, id);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.webhooks.remove(req.workspaceId!, req.userId!, id);
  }
}
