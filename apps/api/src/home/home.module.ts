import { Module } from "@nestjs/common";
import { AccessModule } from "../access/access.module";
import { TasksModule } from "../tasks/tasks.module";
import { HomeController } from "./home.controller";
import { HomeService } from "./home.service";

/**
 * Module 14: Home / My Work. AccessModule supplies visibleSpaceIds; TasksModule
 * exports TasksService so Home renders the identical TaskCard shape. Read-only.
 */
@Module({
  imports: [AccessModule, TasksModule],
  controllers: [HomeController],
  providers: [HomeService],
})
export class HomeModule {}
