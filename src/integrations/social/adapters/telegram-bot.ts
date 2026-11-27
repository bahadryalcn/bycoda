import type { SocialAdapter, SocialHttp } from "../adapter";
import { SocialPlatformError } from "../adapter";
import type { CollectedPerson } from "../audience-types";
import {
  parseTelegramDiscussionThread,
  parseTelegramUpdate,
  telegramChatName,
  telegramDiscussionThread,
} from "../telegram-webhook";
import { mediaFormat, messageText, messagingContentIssue } from "./messaging-shared";
import { deleteTelegramMessage } from "./telegram-api";

const chatId = (raw: unknown): string => {
  const value = String(raw ?? "");
  if (!/^-?\d{1,20}$/.test(value)) throw new SocialPlatformError("rejected");
  return value;
};

export function createTelegramAdapter(http: SocialHttp): SocialAdapter {
  return {
    ignoresPublishedPosts: true,
    async send(account, job, token, media, _checkpoint, beforeSubmit) {
      if (messagingContentIssue(account, job)) throw new SocialPlatformError("unsupported");
      const text = messageText(job);
      const discussion = parseTelegramDiscussionThread(job.payload.threadId);
      if (
        discussion &&
        (account.accountType !== "bot" ||
          job.kind !== "reply" ||
          job.payload.recipientId !== discussion.chatId)
      )
        throw new SocialPlatformError("denied");
      const recipient = chatId(
        discussion?.chatId ?? job.payload.threadId ?? job.payload.recipientId,
      );
      const reply = discussion
        ? { message_id: discussion.rootId, allow_sending_without_reply: false }
        : undefined;
      const item = job.payload.media[0];
      let body: Record<string, unknown> | FormData = {
        chat_id: recipient,
        text,
        ...(reply ? { reply_parameters: reply } : {}),
      };
      let method: "sendMessage" | "sendPhoto" | "sendVideo" = "sendMessage";
      if (item) {
        const bytes = await media(item.uploadId!);
        const format = mediaFormat(item, bytes, "telegram");
        const form = new FormData();
        form.set("chat_id", recipient);
        if (text) form.set("caption", text);
        if (reply) form.set("reply_parameters", JSON.stringify(reply));
        form.set(
          item.kind === "image" ? "photo" : "video",
          new Blob([new Uint8Array(bytes)], { type: format.mime }),
          format.name,
        );
        body = form;
        method = item.kind === "image" ? "sendPhoto" : "sendVideo";
      }
      if (discussion) {
        const me = await http.telegram("getMe", token);
        if (
          me?.is_bot !== true ||
          !Number.isSafeInteger(me.id) ||
          String(me.id) !== account.platformId
        )
          throw new SocialPlatformError("denied");
        const group = await http.telegram("getChat", token, { chat_id: recipient });
        if (
          group?.type !== "supergroup" ||
          !Number.isSafeInteger(group.id) ||
          String(group.id) !== recipient ||
          !Number.isSafeInteger(group.linked_chat_id) ||
          String(group.linked_chat_id) !== discussion.channelId
        )
          throw new SocialPlatformError("denied");
      }
      await beforeSubmit?.();
      const result = await http.telegram(method, token, body);
      if (
        !Number.isSafeInteger(result?.message_id) ||
        result.message_id <= 0 ||
        String(result.chat?.id) !== recipient ||
        (item ? (result.caption ?? "") !== text : result.text !== text) ||
        (discussion &&
          (result.chat?.type !== "supergroup" ||
            telegramDiscussionThread(result.reply_to_message) !== job.payload.threadId)) ||
        (item?.kind === "image" &&
          (!Array.isArray(result.photo) ||
            !result.photo.some(
              (photo: { file_id?: unknown }) =>
                typeof photo?.file_id === "string" && !!photo.file_id,
            ))) ||
        (item?.kind === "video" &&
          (typeof result.video?.file_id !== "string" || !result.video.file_id))
      )
        throw new SocialPlatformError("unknown");
      return { platformId: `${chatId(result.chat.id)}:${result.message_id}` };
    },
    async poll(_account, token, _posts, cursor) {
      const offset = cursor === undefined ? 0 : Number(cursor);
      if (!Number.isSafeInteger(offset) || offset < 0) throw new SocialPlatformError("rejected");
      const updates = await http.telegram("getUpdates", token, {
        offset,
        limit: 100,
        timeout: 0,
        allowed_updates: ["message"],
      });
      if (!Array.isArray(updates)) throw new SocialPlatformError("rejected");
      let next = offset;
      const events = [];
      for (const update of updates) {
        if (!Number.isSafeInteger(update.update_id) || update.update_id < offset) continue;
        next = Math.max(next, update.update_id + 1);
        const message = update.message;
        if (message?.is_automatic_forward === true) {
          const incoming = parseTelegramUpdate(update);
          if (incoming) events.push(incoming.event);
          continue;
        }
        if (
          !message ||
          message.from?.is_bot ||
          typeof message.text !== "string" ||
          !Number.isSafeInteger(message.date) ||
          !Number.isSafeInteger(message.message_id)
        )
          continue;
        const chat = chatId(message.chat?.id);
        events.push({
          eventId: `${chat}:${message.message_id}`,
          threadId: chat,
          contactId: chat,
          contactName: telegramChatName(message.chat) ?? chat,
          kind: "message" as const,
          text: message.text,
          at: message.date * 1000,
        });
      }
      return { events, cursor: String(next) };
    },
    async deletePost(_account, token, platformId) {
      await deleteTelegramMessage(http, token, platformId);
    },
    /**
     * Private users who wrote to the bot. offset 0 never confirms an update, so the inbox cursor
     * is unaffected. Telegram keeps unconfirmed updates for a limited time, so this is a bounded view.
     */
    async collectAudience(account, token, source) {
      if (source.kind !== "dm_senders" || source.accountId !== account.id)
        throw new SocialPlatformError("unsupported");
      const updates = await http.telegram("getUpdates", token, {
        offset: 0,
        limit: 100,
        timeout: 0,
        allowed_updates: ["message"],
      });
      if (!Array.isArray(updates)) throw new SocialPlatformError("rejected");
      const people = new Map<string, CollectedPerson>();
      for (const update of updates) {
        const parsed = parseTelegramUpdate(update);
        if (!parsed?.privateChat) continue;
        const previous = people.get(parsed.event.threadId);
        if (previous && previous.at >= parsed.event.at) continue;
        people.set(parsed.event.threadId, {
          platformId: parsed.event.threadId,
          name: parsed.event.contactName,
          ...(parsed.username ? { username: parsed.username } : {}),
          kind: "dm",
          ref: parsed.event.eventId,
          at: parsed.event.at,
        });
      }
      return { people: [...people.values()] };
    },
    async healthCheck(_account, token) {
      try {
        const me = await http.telegram("getMe", token);
        return me?.is_bot === true ? { ok: true } : { ok: false, code: "rejected" };
      } catch (error) {
        if (error instanceof SocialPlatformError) return { ok: false, code: error.code };
        throw error;
      }
    },
  };
}
