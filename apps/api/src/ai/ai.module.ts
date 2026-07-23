import { Module } from "@nestjs/common";
import { AiController } from "./ai.controller";
import { AiProvider } from "./ai.provider";
import { AiService } from "./ai.service";
import { AiBuilderService } from "./ai-builder.service";
import { AiAskService } from "./ai-ask.service";
import { HierarchyModule } from "../hierarchy/hierarchy.module";
import { TasksModule } from "../tasks/tasks.module";
import { DocsModule } from "../docs/docs.module";
import { FormsModule } from "../forms/forms.module";
import { SearchModule } from "../search/search.module";

/**
 * Module 15 — AI Brain. AiProvider is exported so other modules could reuse
 * the pluggable Claude/heuristic completion path in future. The AI Builder
 * reuses the hierarchy/tasks/docs create services so every AI-driven creation
 * still runs through RLS, role capabilities and plan limits.
 */
@Module({
  imports: [HierarchyModule, TasksModule, DocsModule, FormsModule, SearchModule],
  controllers: [AiController],
  providers: [AiService, AiProvider, AiBuilderService, AiAskService],
  exports: [AiProvider, AiService],
})
export class AiModule {}
