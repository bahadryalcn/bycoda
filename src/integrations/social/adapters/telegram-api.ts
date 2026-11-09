import type { SocialHttp } from "../adapter";
import { SocialPlatformError } from "../adapter";

/**
 * Bot API methods beyond the original send/poll set. Calls go through the token-safe SocialHttp client.
 * Limits marked "unverified" were not checked against the current Bot API reference (no web lookup).
 */
export const TELEGRAM_BOT_LIMITS = {
  text: 4096,
  caption: 1024,
  pollQuestion: 300, // unverified against current Bot API docs
  pollOption: 100, // unverified against current Bot API docs
  pollOptions: 10,
  buttonText: 64, // shortcut: conservative label bound, unverified
  callbackData: 64, // bytes
  buttonRows: 8, // shortcut: conservative layout bound
  buttonsPerRow: 8, // shortcut: conservative layout bound
} as const;

export type TelegramMethod =
  | "sendPoll"
  | "sendMessage"
  | "editMessageText"
  | "deleteMessage"
  | "pinChatMessage"
  | "unpinChatMessage"
  | "setWebhook"
  | "deleteWebhook";

export type TelegramButton = { text: string; callbackData: string } | { text: string; url: string };
export type TelegramPoll = { question: string; options: readonly string[] };

const CHAT = /^-?[1-9]\d{0,19}$/;
const PLATFORM_ID = /^(-?[1-9]\d{0,19}):([1-9]\d{0,15})$/;
const WEBHOOK_SECRET = /^[A-Za-z0-9_-]{32,256}$/;
const codePoints = (value: string) => [...value].length;

/** Calls a Bot API method through the shared, token-safe HTTP client. */
export function callTelegram(
  http: SocialHttp,
  method: TelegramMethod,
  token: string,
  body: Record<string, unknown>,
): Promise<Record<string, any>> {
  // shortcut: SocialHttp.telegram's method union in adapter.ts predates these methods; widen it there and drop this cast.
  return http.telegram(method as never, token, body);
}

/** Splits a stored `<chatId>:<messageId>` identifier. Anything else is refused before any request. */
export function parseTelegramPlatformId(platformId: string): { chatId: string; messageId: number } {
  const match = PLATFORM_ID.exec(platformId);
  const messageId = match ? Number(match[2]) : Number.NaN;
  if (!match || !Number.isSafeInteger(messageId)) throw new SocialPlatformError("rejected");
  return { chatId: match[1]!, messageId };
}

function requireChat(chatId: string): string {
  if (!CHAT.test(chatId)) throw new SocialPlatformError("rejected");
  return chatId;
}

/** Acknowledgement of a sent or edited message must name the same chat; anything else is uncertain. */
function confirmedMessage(result: Record<string, any> | undefined, chatId: string): string {
  const messageId = result?.message_id;
  if (!Number.isSafeInteger(messageId) || messageId <= 0 || String(result?.chat?.id) !== chatId)
    throw new SocialPlatformError("unknown");
  return `${chatId}:${messageId}`;
}

function requireTrue(result: unknown): void {
  if (result !== true) throw new SocialPlatformError("unknown");
}

export function pollBody(poll: TelegramPoll): Record<string, unknown> {
  const question = poll.question.trim();
  if (
    !question ||
    codePoints(question) > TELEGRAM_BOT_LIMITS.pollQuestion ||
    poll.options.length < 2 ||
    poll.options.length > TELEGRAM_BOT_LIMITS.pollOptions ||
    poll.options.some(
      (option) => !option.trim() || codePoints(option) > TELEGRAM_BOT_LIMITS.pollOption,
    )
  )
    throw new SocialPlatformError("rejected");
  return { question, options: [...poll.options], type: "regular", is_anonymous: true };
}

/** Validates a keyboard before any request. Callback data is bounded in bytes, URLs must be HTTPS. */
export function keyboardMarkup(
  rows: readonly (readonly TelegramButton[])[],
): Record<string, unknown> {
  if (
    !rows.length ||
    rows.length > TELEGRAM_BOT_LIMITS.buttonRows ||
    rows.some((row) => !row.length || row.length > TELEGRAM_BOT_LIMITS.buttonsPerRow)
  )
    throw new SocialPlatformError("rejected");
  return {
    inline_keyboard: rows.map((row) =>
      row.map((button) => {
        if (!button.text.trim() || codePoints(button.text) > TELEGRAM_BOT_LIMITS.buttonText)
          throw new SocialPlatformError("rejected");
        if ("url" in button) {
          let url: URL | undefined;
          try {
            url = new URL(button.url);
          } catch {
            url = undefined;
          }
          if (
            !url ||
            url.protocol !== "https:" ||
            url.username ||
            url.password ||
            url.href.length > 2048
          )
            throw new SocialPlatformError("rejected");
          return { text: button.text, url: url.href };
        }
        if (
          !button.callbackData ||
          new TextEncoder().encode(button.callbackData).byteLength >
            TELEGRAM_BOT_LIMITS.callbackData
        )
          throw new SocialPlatformError("rejected");
        return { text: button.text, callback_data: button.callbackData };
      }),
    ),
  };
}

export async function sendTelegramPoll(
  http: SocialHttp,
  token: string,
  chatId: string,
  poll: TelegramPoll,
): Promise<{ platformId: string }> {
  const chat = requireChat(chatId);
  const body = pollBody(poll);
  const result = await callTelegram(http, "sendPoll", token, { chat_id: chat, ...body });
  if (!result?.poll || typeof result.poll !== "object") throw new SocialPlatformError("unknown");
  return { platformId: confirmedMessage(result, chat) };
}

export async function sendTelegramButtons(
  http: SocialHttp,
  token: string,
  chatId: string,
  text: string,
  rows: readonly (readonly TelegramButton[])[],
): Promise<{ platformId: string }> {
  const chat = requireChat(chatId);
  if (!text.trim() || text.length > TELEGRAM_BOT_LIMITS.text)
    throw new SocialPlatformError("rejected");
  const result = await callTelegram(http, "sendMessage", token, {
    chat_id: chat,
    text,
    reply_markup: keyboardMarkup(rows),
  });
  return { platformId: confirmedMessage(result, chat) };
}

export async function editTelegramMessage(
  http: SocialHttp,
  token: string,
  platformId: string,
  text: string,
  rows?: readonly (readonly TelegramButton[])[],
): Promise<{ platformId: string }> {
  const target = parseTelegramPlatformId(platformId);
  if (!text.trim() || text.length > TELEGRAM_BOT_LIMITS.text)
    throw new SocialPlatformError("rejected");
  const result = await callTelegram(http, "editMessageText", token, {
    chat_id: target.chatId,
    message_id: target.messageId,
    text,
    ...(rows ? { reply_markup: keyboardMarkup(rows) } : {}),
  });
  if (result?.message_id !== target.messageId) throw new SocialPlatformError("unknown");
  return { platformId: confirmedMessage(result, target.chatId) };
}

export async function deleteTelegramMessage(
  http: SocialHttp,
  token: string,
  platformId: string,
): Promise<void> {
  const target = parseTelegramPlatformId(platformId);
  requireTrue(
    await callTelegram(http, "deleteMessage", token, {
      chat_id: target.chatId,
      message_id: target.messageId,
    }),
  );
}

export async function setTelegramPinned(
  http: SocialHttp,
  token: string,
  platformId: string,
  pinned: boolean,
): Promise<void> {
  const target = parseTelegramPlatformId(platformId);
  requireTrue(
    await callTelegram(http, pinned ? "pinChatMessage" : "unpinChatMessage", token, {
      chat_id: target.chatId,
      message_id: target.messageId,
      disable_notification: true,
    }),
  );
}

/** HTTPS only, on the ports Telegram accepts for webhooks (443, 8443). The secret must match the webhook header check. */
export async function setTelegramWebhook(
  http: SocialHttp,
  token: string,
  url: string,
  secret: string,
): Promise<void> {
  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {
    parsed = undefined;
  }
  if (
    !parsed ||
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    (parsed.port !== "" && parsed.port !== "443" && parsed.port !== "8443") ||
    !WEBHOOK_SECRET.test(secret)
  )
    throw new SocialPlatformError("rejected");
  requireTrue(
    await callTelegram(http, "setWebhook", token, {
      url: parsed.href,
      secret_token: secret,
      allowed_updates: ["message"],
      drop_pending_updates: false,
    }),
  );
}

export async function deleteTelegramWebhook(http: SocialHttp, token: string): Promise<void> {
  requireTrue(await callTelegram(http, "deleteWebhook", token, { drop_pending_updates: false }));
}
