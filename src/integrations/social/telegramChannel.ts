import type { SocialAccount, SocialJob } from "../../features/social/model/social";
import type { SocialAdapter } from "./adapter";
import { SocialHttp, SocialPlatformError } from "./adapter";
import { mediaFormat, messagingContentIssue } from "./messaging";

const canonicalId = (value: unknown, channel: boolean): value is string =>
  typeof value === "string" &&
  (channel ? /^-[1-9]\d{0,15}$/ : /^[1-9]\d{0,15}$/).test(value) &&
  Number.isSafeInteger(Number(value));
const exactId = (value: unknown, expected: string) =>
  typeof value === "number" && Number.isSafeInteger(value) && String(value) === expected;
const textFor = (job: Pick<SocialJob, "payload">) =>
  [job.payload.text, job.payload.link].filter(Boolean).join("\n");

/** Channel publication is a separate asset operation; it never borrows DM consent. */
export function telegramChannelContentIssue(
  account: SocialAccount,
  job: Pick<SocialJob, "kind" | "payload">,
): string | undefined {
  if (
    account.platform !== "telegram" ||
    account.accountType !== "channel" ||
    account.connection !== "token" ||
    !canonicalId(account.platformId, true) ||
    !canonicalId(account.telegramBotId, false)
  )
    return "Connect the Telegram channel using its numeric channel ID and verified administrator bot.";
  if (
    job.kind !== "publish" ||
    job.payload.recipientId ||
    job.payload.threadId ||
    job.payload.postId
  )
    return "Telegram channel connections support channel publishing only; bot direct messages use a separate account.";
  return messagingContentIssue({ platform: "telegram" }, { ...job, kind: "message" });
}

/** Uses numeric channel IDs only; public URLs are emitted only after fresh username verification. */
export function createTelegramChannelAdapter(http: SocialHttp): SocialAdapter {
  return {
    async send(account, job, token, read, _checkpoint, beforeSubmit) {
      if (telegramChannelContentIssue(account, job)) throw new SocialPlatformError("unsupported");
      const channelId = account.platformId;
      const botId = account.telegramBotId!;
      const text = textFor(job);
      const item = job.payload.media[0];
      let method: "sendMessage" | "sendPhoto" | "sendVideo" = "sendMessage";
      let body: Record<string, unknown> | FormData = { chat_id: channelId, text };
      if (item) {
        const bytes = await read(item.uploadId!);
        if (item.kind === "image" && bytes.length > 5 * 1024 * 1024)
          throw new SocialPlatformError("rejected");
        const format = mediaFormat(item, bytes, "telegram");
        const form = new FormData();
        form.set("chat_id", channelId);
        if (text) form.set("caption", text);
        form.set(
          item.kind === "image" ? "photo" : "video",
          new Blob([new Uint8Array(bytes)], { type: format.mime }),
          format.name,
        );
        body = form;
        method = item.kind === "image" ? "sendPhoto" : "sendVideo";
      }

      // Check the same bot, same channel and current posting role after media preparation.
      const me = await http.telegram("getMe", token);
      if (!exactId(me?.id, botId) || me?.is_bot !== true) throw new SocialPlatformError("denied");
      const chat = await http.telegram("getChat", token, { chat_id: channelId });
      if (!exactId(chat?.id, channelId) || chat?.type !== "channel")
        throw new SocialPlatformError("denied");
      const member = await http.telegram("getChatMember", token, {
        chat_id: channelId,
        user_id: Number(botId),
      });
      if (
        !exactId(member?.user?.id, botId) ||
        member?.user?.is_bot !== true ||
        member?.status !== "administrator" ||
        member?.can_post_messages !== true
      )
        throw new SocialPlatformError("denied");
      await beforeSubmit?.();
      const result = await http.telegram(method, token, body);
      if (
        !Number.isSafeInteger(result?.message_id) ||
        result.message_id <= 0 ||
        !exactId(result?.chat?.id, channelId) ||
        result?.chat?.type !== "channel" ||
        (!item && result?.text !== text) ||
        (item && (result?.caption ?? "") !== text) ||
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
      const username =
        typeof chat.username === "string" && /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(chat.username)
          ? chat.username
          : undefined;
      return {
        platformId: `${channelId}:${result.message_id}`,
        ...(username ? { url: `https://t.me/${username}/${result.message_id}` } : {}),
      };
    },
    async poll() {
      // getUpdates is bot-wide; a channel asset must never consume another bot account's inbox.
      throw new SocialPlatformError("unsupported");
    },
  };
}
