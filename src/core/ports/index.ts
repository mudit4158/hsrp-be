// Ports the core depends on. Each has a mock adapter now and a real one later (see /adapters).
export * from './vehicle-registry.port';
export * from './oem.port';
export * from './plate-reader.port';
export { MESSAGE_SENDER, type MessageSender } from '../../utility/notification/message-sender.port';
export { PAYMENT_PROVIDER, type PaymentProvider } from '../../utility/payments/payment-provider.port';
export { FILE_STORE, type FileStore } from '../../utility/file-storage/file-store.port';
