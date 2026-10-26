import type { SocialAdapter } from "./adapter";
import { SocialHttp, SocialPlatformError } from "./adapter";
import type { SocialAccount, SocialJob, SocialMedia } from "../../features/social/model/social";

const chatId = (raw: unknown): string => {
  const value = String(raw ?? "");
  if (!/^-?\d{1,20}$/.test(value)) throw new SocialPlatformError("rejected");
  return value;
};

const messageText = (job: Pick<SocialJob, "payload">) =>
  [job.payload.text, job.payload.link].filter(Boolean).join("\n");

/** Shared preview/dispatch validation for the two API messaging adapters. */
export function messagingContentIssue(
  account: Pick<SocialAccount, "platform">,
  job: Pick<SocialJob, "payload" | "kind">,
): string | undefined {
  const message =
    job.kind === "message" ||
    (job.kind === "reply" && !!job.payload.recipientId && !job.payload.postId);
  if (!message || (account.platform === "whatsapp" && job.kind !== "reply"))
    return "This API supports existing Telegram bot chats or WhatsApp customer replies only.";
  const items = job.payload.media;
  if (items.length > 1) return "Messages accept one uploaded PNG/JPEG image or MP4 video.";
  if (
    items.some(
      (item) =>
        (item.kind !== "image" && item.kind !== "video") ||
        !item.uploadId ||
        item.url ||
        item.alt ||
        item.title,
    )
  )
    return "Messages require one host-uploaded PNG/JPEG image or MP4 video, without alternative text or a document title.";
  const text = messageText(job);
  if (!items.length && !text.trim()) return "Enter message text or attach an image or video.";
  if (text.length > (items.length ? 1024 : 4096))
    return items.length
      ? "Media captions including links must fit 1024 UTF-16 characters."
      : "Messages including links must fit 4096 UTF-16 characters.";
}

export function mediaFormat(
  item: SocialMedia,
  bytes: Uint8Array,
  platform: "telegram" | "whatsapp",
): { mime: "image/png" | "image/jpeg" | "video/mp4"; name: string } {
  const imageLimit = (platform === "telegram" ? 10 : 5) * 1024 * 1024;
  const videoLimit = (platform === "telegram" ? 50 : 16) * 1024 * 1024;
  if (item.kind === "image" && bytes.length <= imageLimit) {
    if (
      bytes.length >= 8 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
    )
      return { mime: "image/png", name: "image.png" };
    if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
      return { mime: "image/jpeg", name: "image.jpg" };
  }
  if (
    item.kind === "video" &&
    bytes.length >= 12 &&
    bytes.length <= videoLimit &&
    String.fromCharCode(...bytes.subarray(4, 8)) === "ftyp"
  )
    return { mime: "video/mp4", name: "video.mp4" };
  throw new SocialPlatformError("rejected");
}

const validWhatsAppMediaId = (value: unknown): value is string =>
  typeof value === "string" && /^\d{1,30}$/.test(value);

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
    async send(account, job, token, media, _checkpoint, beforeSubmit) {
      if (messagingContentIssue(account, job)) throw new SocialPlatformError("unsupported");
      const text = messageText(job);
      const recipient = chatId(job.payload.threadId ?? job.payload.recipientId);
      const item = job.payload.media[0];
      let body: Record<string, unknown> | FormData = { chat_id: recipient, text };
      let method: "sendMessage" | "sendPhoto" | "sendVideo" = "sendMessage";
      if (item) {
        const bytes = await media(item.uploadId!);
        const format = mediaFormat(item, bytes, "telegram");
        const form = new FormData();
        form.set("chat_id", recipient);
        if (text) form.set("caption", text);
        form.set(
          item.kind === "image" ? "photo" : "video",
          new Blob([new Uint8Array(bytes)], { type: format.mime }),
          format.name,
        );
        body = form;
        method = item.kind === "image" ? "sendPhoto" : "sendVideo";
      }
      await beforeSubmit?.();
      const result = await http.telegram(method, token, body);
      if (
        !Number.isSafeInteger(result?.message_id) ||
        result.message_id <= 0 ||
        String(result.chat?.id) !== recipient ||
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
    async send(account, job, token, media, checkpoint, beforeSubmit) {
      if (messagingContentIssue(account, job)) throw new SocialPlatformError("unsupported");
      const recipient = job.payload.recipientId;
      if (!/^\d+$/.test(account.platformId) || !/^\d{5,20}$/.test(recipient ?? ""))
        throw new SocialPlatformError("rejected");
      const body = messageText(job);
      const item = job.payload.media[0];
      let message: Record<string, unknown> = {
        type: "text",
        text: { body, preview_url: false },
      };
      if (item) {
        let id = job.preparation?.mediaIds?.[0];
        if (
          job.preparation?.mediaIds &&
          (job.preparation.mediaIds.length !== 1 || !validWhatsAppMediaId(id))
        )
          throw new SocialPlatformError("rejected");
        if (!id) {
          const bytes = await media(item.uploadId!);
          const format = mediaFormat(item, bytes, "whatsapp");
          const form = new FormData();
          form.set("messaging_product", "whatsapp");
          form.set("type", format.mime);
          form.set("file", new Blob([new Uint8Array(bytes)], { type: format.mime }), format.name);
          const uploaded = await http.request(
            `https://graph.facebook.com/${graphVersion}/${account.platformId}/media`,
            token,
            { method: "POST", body: form },
          );
          id = uploaded.value.id;
          if (!validWhatsAppMediaId(id)) throw new SocialPlatformError("unknown");
          job.preparation = { ...job.preparation, mediaIds: [id] };
          await checkpoint?.(job.preparation);
        }
        message = {
          type: item.kind,
          [item.kind]: { id, ...(body ? { caption: body } : {}) },
        };
      }
      await beforeSubmit?.();
      const { value } = await http.json(
        `https://graph.facebook.com/${graphVersion}/${account.platformId}/messages`,
        token,
        {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: recipient,
          ...message,
        },
      );
      const platformId = value.messages?.[0]?.id;
      if (
        typeof platformId !== "string" ||
        !platformId ||
        !Array.isArray(value.messages) ||
        value.messages.length !== 1 ||
        (value.contacts !== undefined &&
          (!Array.isArray(value.contacts) ||
            value.contacts.length !== 1 ||
            value.contacts[0]?.wa_id !== recipient))
      )
        throw new SocialPlatformError("unknown");
      return { platformId };
    },
    async poll() {
      throw new SocialPlatformError("unsupported");
    },
  };
}
