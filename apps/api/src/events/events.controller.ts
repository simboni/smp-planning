import { Controller, Get, Query, Req, Res, UseGuards } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Request, Response } from "express";
import type { WorkspaceTokenClaims } from "@stackup/shared";
import {
  AuthedRequest,
  JwtAuthGuard,
  WorkspaceGuard,
} from "../auth/guards";
import { DbService } from "../db/db.service";
import { EventsService } from "./events.service";

/**
 * Live event stream + presence for Module 6.
 *
 * GET /events/stream is a raw SSE endpoint. EventSource cannot set an
 * Authorization header, so the access token rides in ?token= and is verified
 * manually against the same JwtService/secret the guards use. The connection
 * subscribes to the caller's workspace channel, counts into presence, and
 * emits `data: {json}\n\n` per published event with a comment heartbeat
 * every 25s to keep intermediaries from idling the socket out.
 */
@Controller("events")
export class EventsController {
  constructor(
    private readonly jwt: JwtService,
    private readonly events: EventsService,
    private readonly db: DbService,
  ) {}

  @Get("stream")
  async stream(
    @Req() req: Request,
    @Res() res: Response,
    @Query("token") token?: string,
  ): Promise<void> {
    let claims: WorkspaceTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<WorkspaceTokenClaims>(token ?? "");
    } catch {
      res.status(401).json({ statusCode: 401, message: "Invalid or expired token" });
      return;
    }
    if (claims.typ !== "access" || !claims.wsp || !claims.sub) {
      res.status(401).json({
        statusCode: 401,
        message: "Select a workspace first (access token required)",
      });
      return;
    }
    const workspaceId = claims.wsp;
    const userId = claims.sub;

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    res.write(": connected\n\n");

    const unsubscribe = this.events.subscribe(workspaceId, (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    this.events.connect(workspaceId, userId);
    this.events.publishPresence(workspaceId);

    const heartbeat = setInterval(() => {
      res.write(": hb\n\n");
    }, 25_000);
    heartbeat.unref?.();

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      this.events.disconnect(workspaceId, userId);
      this.events.publishPresence(workspaceId);
    });
  }

  @Get("online")
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async online(@Req() req: AuthedRequest) {
    const ids = this.events.online(req.workspaceId!);
    if (ids.length === 0) return { online: [] };
    const res = await this.db.query(
      `SELECT id, full_name, avatar_url FROM users WHERE id = ANY($1)`,
      [ids],
    );
    return {
      online: res.rows.map((r) => ({
        id: r.id as string,
        fullName: r.full_name as string,
        avatarUrl: (r.avatar_url as string | null) ?? null,
      })),
    };
  }
}
