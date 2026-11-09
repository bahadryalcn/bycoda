/** Compatibility re-exports. The implementations live in ./adapters/telegram-bot, ./adapters/whatsapp and ./adapters/messaging-shared. */
export { createTelegramAdapter } from "./adapters/telegram-bot";
export { createWhatsAppAdapter } from "./adapters/whatsapp";
export { mediaFormat, messagingContentIssue } from "./adapters/messaging-shared";
