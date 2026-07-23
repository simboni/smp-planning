import { Module } from "@nestjs/common";
import { AiController } from "./ai.controller";
import { AiProvider } from "./ai.provider";
import { AiService } from "./ai.service";
import { AiBuilderService } from "./ai-builder.service";
import { AiAskService } from "./ai-ask.service";
import { AiContextService } from "./ai-context.service";
import { AiOperatorService } from "./ai-operator.service";
import { HierarchyModule } from "../hierarchy/hierarchy.module";
import { TasksModule } from "../tasks/tasks.module";
import { DocsModule } from "../docs/docs.module";
import { FormsModule } from "../forms/forms.module";
import { SearchModule } from "../search/search.module";
import { AccessModule } from "../access/access.module";
import { ChatModule } from "../chat/chat.module";
import { CommentsModule } from "../comments/comments.module";

/**
 * Module 15 — AI Brain / StackUp Copilot. The Builder, Ask and Do (operator)
 * services all reuse the real create/read/update services (tasks, hierarchy,
 * docs, forms, search, chat, comments) so every AI-driven read and write runs
 * through RLS, role capabilities and plan limits. AiProvider is exported for
 * reuse elsewhere.
 */
@Module({
  imports: [
    HierarchyModule,
    TasksModule,
    DocsModule,
    FormsModule,
    SearchModule,
    AccessModule,
    ChatModule,
    CommentsModule,
  ],
  controllers: [AiController],
  providers: [
    AiService,
    AiProvider,
    AiBuilderService,
    AiAskService,
    AiContextService,
    AiOperatorService,
  ],
  exports: [AiProvider, AiService],
})
export class AiModule {}
