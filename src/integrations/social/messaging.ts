import type { SocialAdapter } from "./adapter";
import { SocialHttp, SocialPlatformError } from "./adapter";

const chatId = (raw: unknown): string => {
  const value = String(raw ?? "");
  if (!/^-?\d{1,20}$/.test(value)) throw new SocialPlatformError("rejected");
  return value;
};

export const profileOnlyAdapter: SocialAdapter = {
  async send() {
    throw new SocialPlatformError("unsupported");
  },
  async poll() {
    throw new SocialPlatformError("unsupported");
  },
};

export function createTelegramAdapter(http: SocialHttp): SocialAdapter {
  return {
    async send(_account, job, token) {
      if (
        !(
          job.kind === "message" ||
          (job.kind === "reply" && job.payload.recipientId && !job.payload.postId)
        ) ||
        job.payload.media.length
      )
        throw new SocialPlatformError("unsupported");
      const text = [job.payload.text, job.payload.link].filter(Boolean).join("\n");
      if (!text || text.length > 4096) throw new SocialPlatformError("rejected");
      const result = await http.telegram("sendMessage", token, {
        chat_id: chatId(job.payload.threadId ?? job.payload.recipientId),
        text,
      });
      if (!Number.isSafeInteger(result.message_id) || !result.chat?.id)
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
          contactName: String(
            message.chat.title ?? message.chat.username ?? message.chat.first_name ?? chat,
          ),
          kind: "message" as const,
          text: message.text,
          at: message.date * 1000,
        });
      }
      return { events, cursor: String(next) };
    },
  };
}

export function createWhatsAppAdapter(http: SocialHttp, graphVersion: string): SocialAdapter {
  return {
    async send(account, job, token) {
      if (
        job.kind !== "reply" ||
        !job.payload.recipientId ||
        job.payload.postId ||
        job.payload.media.length
      )
        throw new SocialPlatformError("unsupported");
      if (!/^\d+$/.test(account.platformId) || !/^\d{5,20}$/.test(job.payload.recipientId))
        throw new SocialPlatformError("rejected");
      const body = [job.payload.text, job.payload.link].filter(Boolean).join("\n");
      if (!body || body.length > 4096) throw new SocialPlatformError("rejected");
      const { value } = await http.json(
        `https://graph.facebook.com/${graphVersion}/${account.platformId}/messages`,
        token,
        {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: job.payload.recipientId,
          type: "text",
          text: { body, preview_url: false },
        },
      );
      const platformId = value.messages?.[0]?.id;
      if (typeof platformId !== "string" || !platformId) throw new SocialPlatformError("unknown");
      return { platformId };
    },
    async poll() {
      throw new SocialPlatformError("unsupported");
    },
  };
}
