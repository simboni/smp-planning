import { Module } from "@nestjs/common";
import { AiController } from "./ai.controller";
import { AiProvider } from "./ai.provider";
import { AiService } from "./ai.service";

/**
 * Module 15 — AI Brain. AiProvider is exported so other modules could reuse
 * the pluggable Claude/heuristic completion path in future.
 */
@Module({
  controllers: [AiController],
  providers: [AiService, AiProvider],
  exports: [AiProvider, AiService],
})
export class AiModule {}
