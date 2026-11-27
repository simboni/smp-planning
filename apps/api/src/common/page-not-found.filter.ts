import { ArgumentsHost, Catch, NotFoundException } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import type { Request, Response } from "express";

/**
 * Pages and the API share one origin, so a mistyped address in the browser
 * used to show Nest's raw JSON ("Cannot GET /x"). When a browser navigation
 * (Accept: text/html) matches no page AND no API route, serve the web app's
 * branded 404 page instead. API calls (fetch sends Accept: * / *) and real API
 * 404s ("Task not found") are untouched; so are API routes a browser opens on
 * purpose, like file downloads or email links, because those match a route.
 */
@Catch(NotFoundException)
export class PageNotFoundFilter extends BaseExceptionFilter {
  constructor(
    private readonly notFoundPage: string | null,
    ...rest: ConstructorParameters<typeof BaseExceptionFilter>
  ) {
    super(...rest);
  }

  override catch(exception: NotFoundException, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const body = exception.getResponse() as { message?: unknown } | string;
    const message = typeof body === "string" ? body : body?.message;
    const isUnmatchedRoute =
      typeof message === "string" && message.startsWith(`Cannot ${req.method} `);
    const isPageNavigation =
      req.method === "GET" && (req.headers.accept ?? "").includes("text/html");
    if (this.notFoundPage && isUnmatchedRoute && isPageNavigation && !res.headersSent) {
      res.status(404).type("html").sendFile(this.notFoundPage);
      return;
    }
    super.catch(exception, host);
  }
}
