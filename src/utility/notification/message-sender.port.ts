export const MESSAGE_SENDER = Symbol('MessageSender');

export interface OutboundMessage {
  channel: 'SMS' | 'EMAIL';
  to: string;
  senderId: string;
  dltTemplateId?: string | null;
  subject?: string | null;
  body: string;
}

/** Port for SMS and email gateways. Implementations live in /adapters. */
export interface MessageSender {
  send(message: OutboundMessage): Promise<{ providerRef: string }>;
}
