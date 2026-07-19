import { Global, Module } from "@nestjs/common";
import { EventsController } from "./events.controller";
import { EventsService } from "./events.service";

/**
 * Global (like DbModule) so any feature service can inject the single
 * EventsService bus and publish realtime hints without import cycles —
 * tasks and comments both publish; only this module subscribes (SSE).
 */
@Global()
@Module({
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
