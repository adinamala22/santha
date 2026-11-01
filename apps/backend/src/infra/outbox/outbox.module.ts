import { Global, Module } from '@nestjs/common';
import { EventBus } from './event-bus';
import { EventsWorker } from './events.worker';
import { OutboxRelayService } from './outbox-relay.service';
import { OutboxStore, PrismaOutboxStore } from './outbox.store';

@Global()
@Module({
  providers: [{ provide: OutboxStore, useClass: PrismaOutboxStore }, OutboxRelayService, EventBus, EventsWorker],
  exports: [EventBus],
})
export class OutboxModule {}
