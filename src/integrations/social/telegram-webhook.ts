import type { SocialInbound } from "./adapter";

/** Header Telegram sends with every webhook request when a secret_token was registered. */
export const TELEGRAM_SECRET_HEADER = "x-telegram-bot-api-secret-token";

const SECRET = /^[A-Za-z0-9_-]{32,256}$/;
const CHAT = /^-?[1-9]\d{0,19}$/;
const TEXT_LIMIT = 4096;

/**
 * Constant-time comparison of the request header with the expected secret. Missing, malformed or
 * differently sized values are refused. The route owner must pass the derived per-account secret.
 */
export function verifyTelegramSecret(header: unknown, expected: string): boolean {
  if (typeof header !== "string" || !SECRET.test(expected) || !SECRET.test(header)) return false;
  let difference = header.length ^ expected.length;
  const length = Math.max(header.length, expected.length);
  for (let index = 0; index < length; index++)
    difference |= (header.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  return difference === 0;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** Chat display name: group or channel title, then the person's first name, then username. */
export function telegramChatName(chat: Record<string, unknown>): string | undefined {
  return [chat.title, chat.first_name, chat.username].find(
    (value): value is string => typeof value === "string" && value.trim() !== "",
  );
}

export type TelegramUpdate = {
  event: SocialInbound;
  /** True for one-to-one chats. Groups and supergroups are not direct messages. */
  privateChat: boolean;
  username?: string;
};

/**
 * Parses one webhook update. Only text `message` updates from non-bot senders are returned; channel
 * posts, edits, callbacks and malformed payloads yield undefined without throwing.
 */
export function parseTelegramUpdate(raw: unknown): TelegramUpdate | undefined {
  const update = record(raw);
  const message = record(update?.message);
  const chat = record(message?.chat);
  const from = record(message?.from);
  if (
    !update ||
    !Number.isSafeInteger(update.update_id) ||
    !message ||
    !chat ||
    from?.is_bot === true ||
    chat.type === "channel" ||
    typeof message.text !== "string" ||
    !message.text.trim() ||
    message.text.length > TEXT_LIMIT ||
    !Number.isSafeInteger(message.message_id) ||
    (message.message_id as number) <= 0 ||
    !Number.isSafeInteger(message.date) ||
    (message.date as number) <= 0 ||
    !Number.isSafeInteger(chat.id)
  )
    return undefined;
  const chatId = String(chat.id);
  if (!CHAT.test(chatId)) return undefined;
  const name = telegramChatName(chat);
  const username = typeof chat.username === "string" ? chat.username : undefined;
  return {
    event: {
      eventId: `${chatId}:${message.message_id as number}`,
      threadId: chatId,
      contactId: chatId,
      contactName: (name ?? chatId).slice(0, 200),
      kind: "message",
      text: message.text,
      at: (message.date as number) * 1000,
    },
    privateChat: chat.type === "private",
    ...(username ? { username } : {}),
  };
}
