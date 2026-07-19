import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import express from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module";
import { loadConfig } from "./config";

/**
 * Last-resort safety net: the API should degrade, not die. Anything that
 * escapes local handling (a library emitting 'error' with no listener, a
 * stray rejection) is logged in full and the process keeps serving. Restart-
 * on-crash still exists at the platform layer for truly unrecoverable states.
 */
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION (continuing):", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION (continuing):", reason);
});

async function bootstrap(): Promise<void> {
  // Disable Nest's default 100kb body parser; register our own with a larger
  // limit so base64 file uploads (M12, 5MB decoded ≈ 6.7MB encoded) fit.
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(express.json({ limit: "12mb" }));
  app.use(express.urlencoded({ extended: true, limit: "12mb" }));
  const config = loadConfig();

  // Allowed browser origins: explicit WEB_ORIGINS (comma-separated) else the
  // local web dev server.
  const origins = process.env.WEB_ORIGINS
    ? process.env.WEB_ORIGINS.split(",")
    : ["http://localhost:3001"];
  app.enableCors({ origin: origins });

  // Baseline security headers on every response.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  // Single-origin deploy: if a sibling static web export exists, serve it
  // from this process so there is one URL and no CORS in production.
  const webDir = process.env.WEB_DIST ?? join(__dirname, "..", "web");
  if (existsSync(webDir)) {
    app.use(express.static(webDir, { extensions: ["html"] }));
    console.log(`serving web app from ${webDir}`);
  }

  app.enableShutdownHooks();
  await app.listen(config.port);
  console.log(`stackup-api listening on :${config.port}`);
}

void bootstrap();
