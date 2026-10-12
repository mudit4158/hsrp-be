import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { requestContext } from '../../platform/context/request-context';
import { Db, PrismaService } from '../../platform/database/prisma.service';
import { NonRetryableError, Problem } from '../../platform/http/problem';
import { CallLogService } from '../integration-hub/call-log.service';
import { DeliveredEvent, EventBus } from '../integration-hub/event-bus.service';
import { MESSAGE_SENDER, MessageSender } from './message-sender.port';

export interface SendInput {
  templateCode: string;
  channel: 'SMS' | 'EMAIL';
  recipient: string;
  variables: Record<string, string | number>;
  subjectType?: string;
  subjectId?: string;
}

/** Fills `{{name}}` placeholders. Every placeholder must have a value: wording is fixed by the template. */
export function renderTemplate(body: string, vars: Record<string, string | number>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => {
    if (!(name in vars)) throw new Error(`Missing template variable "${name}"`);
    return String(vars[name]);
  });
}

/**
 * send() renders a template and queues the message in the caller's transaction; the actual gateway call
 * runs from the outbox (subscriber `notification.dispatch`) with retries.
 */
@Injectable()
export class NotificationService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
    private readonly calls: CallLogService,
    @Inject(MESSAGE_SENDER) private readonly sender: MessageSender,
  ) {}

  onModuleInit() {
    this.bus.subscribe('NotificationQueued', 'notification.dispatch', (e) => this.dispatch(e));
  }

  async send(input: SendInput, db: Db = this.prisma) {
    const tenantId = requestContext.tenantId();
    const tpl = await db.notifyTemplate.findUnique({
      where: { tenantId_code_channel: { tenantId, code: input.templateCode, channel: input.channel } },
    });
    if (!tpl?.active) throw Problem.badRequest(`No active ${input.channel} template ${input.templateCode}`, 'template-missing');
    const body = renderTemplate(tpl.body, input.variables);
    const subject = tpl.subject ? renderTemplate(tpl.subject, input.variables) : null;
    const msg = await db.notifyMessage.create({
      data: {
        tenantId,
        templateCode: tpl.code,
        channel: tpl.channel,
        recipient: input.recipient,
        senderId: tpl.senderId,
        dltTemplateId: tpl.dltTemplateId,
        subject,
        body,
        variables: input.variables as Prisma.InputJsonValue,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
      },
    });
    await this.bus.publish(db, { type: 'NotificationQueued', subjectType: 'notification', subjectId: msg.id, payload: { messageId: msg.id } });
    return msg;
  }

  private async dispatch(e: DeliveredEvent) {
    const msg = await this.prisma.notifyMessage.findUnique({ where: { id: String(e.payload.messageId) } });
    if (!msg) throw new NonRetryableError('Message not found');
    if (msg.status === 'SENT') return;
    try {
      const res = await this.calls.track(
        { system: msg.channel, operation: 'send', subjectType: 'notification', subjectId: msg.id, request: { to: msg.recipient, template: msg.templateCode } },
        () => this.sender.send({ channel: msg.channel as 'SMS' | 'EMAIL', to: msg.recipient, senderId: msg.senderId, dltTemplateId: msg.dltTemplateId, subject: msg.subject, body: msg.body }),
      );
      await this.prisma.notifyMessage.update({ where: { id: msg.id }, data: { status: 'SENT', providerRef: res.providerRef, sentAt: new Date(), error: null } });
    } catch (err) {
      await this.prisma.notifyMessage.update({ where: { id: msg.id }, data: { status: 'FAILED', error: (err as Error).message } });
      throw err;
    }
  }
}
