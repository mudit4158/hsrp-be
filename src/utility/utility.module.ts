import { Module } from '@nestjs/common';
import { ApprovalsModule } from './approvals/approvals.module';
import { AuditModule } from './audit/audit.module';
import { ConfigurationModule } from './configuration/configuration.module';
import { DocumentsModule } from './documents/documents.module';
import { FileStorageModule } from './file-storage/file-storage.module';
import { IdentityModule } from './identity/identity.module';
import { ImportExportModule } from './import-export/import-export.module';
import { IntegrationHubModule } from './integration-hub/integration-hub.module';
import { NotificationModule } from './notification/notification.module';
import { PaymentsModule } from './payments/payments.module';
import { ReportingModule } from './reporting/reporting.module';
import { SchedulingModule } from './scheduling/scheduling.module';
import { TicketsModule } from './tickets/tickets.module';
import { WalletModule } from './wallet/wallet.module';

/** The generic, reusable modules. None of them knows anything about HSRP. */
export const UTILITY_MODULES = [
  IntegrationHubModule,
  AuditModule,
  ConfigurationModule,
  IdentityModule,
  NotificationModule,
  FileStorageModule,
  PaymentsModule,
  WalletModule,
  SchedulingModule,
  DocumentsModule,
  ImportExportModule,
  ApprovalsModule,
  TicketsModule,
  ReportingModule,
];

@Module({ imports: UTILITY_MODULES })
export class UtilityModule {}
