import { Global, Module } from '@nestjs/common';
import { CallLogService } from './call-log.service';
import { EventBus } from './event-bus.service';
import { IdempotencyService } from './idempotency.service';
import { IntegrationHubController } from './integration-hub.controller';

@Global()
@Module({
  controllers: [IntegrationHubController],
  providers: [EventBus, IdempotencyService, CallLogService],
  exports: [EventBus, IdempotencyService, CallLogService],
})
export class IntegrationHubModule {}
