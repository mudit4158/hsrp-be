import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { requestContext } from '../../platform/context/request-context';
import { PrismaService } from '../../platform/database/prisma.service';
import { MessageSender, OutboundMessage } from '../../utility/notification/message-sender.port';

/** Stores every SMS and email in adp_mock_outbound_message for the simulator. Nothing is actually sent. */
@Injectable()
export class MockMessageSender implements MessageSender {
  constructor(private readonly prisma: PrismaService) {}

  async send(m: OutboundMessage) {
    if (m.channel === 'SMS' && !m.dltTemplateId) throw new Error('SMS without a DLT template id would be rejected by Indian operators');
    const providerRef = `MOCK-${randomBytes(5).toString('hex').toUpperCase()}`;
    await this.prisma.mockOutboundMessage.create({
      data: { tenantId: requestContext.tenantId(), channel: m.channel, to: m.to, senderId: m.senderId, dltTemplateId: m.dltTemplateId, subject: m.subject, body: m.body, providerRef },
    });
    return { providerRef };
  }
}

@Injectable()
export class RealMessageSender implements MessageSender {
  send(): Promise<{ providerRef: string }> {
    throw new Error('Real SMS/email adapter is not implemented. Set MESSAGE_ADAPTER=mock.');
  }
}
