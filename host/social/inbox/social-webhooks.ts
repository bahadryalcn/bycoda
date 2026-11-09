import { createHmac, timingSafeEqual } from "node:crypto";
import type { SocialAccount } from "../../../src/features/social/model/social";
import {
  parseTelegramUpdate,
  verifyTelegramSecret,
} from "../../../src/integrations/social/telegram-webhook";
import type { SocialInbound } from "../../../src/integrations/social/adapter";
import type { SocialServiceInternals } from "../core/social-internals";
import type { SocialService } from "../social";
import { telegramWebhookSecret } from "../token-connections/telegram";
import { whatsappReceipt } from "../social-delivery";

/** Verifies and ingests one signed Meta or WhatsApp delivery. The caller waits for readiness. */
export async function receiveWebhook(
  s: SocialServiceInternals,
  platform: "instagram" | "facebook" | "whatsapp",
  raw: Buffer,
  signature: string,
  appSecret: string,
): Promise<{
  ingested: number;
}> {
  if (!/^sha256=[a-f0-9]{64}$/.test(signature)) throw new Error("Invalid webhook signature.");
  const expected = createHmac("sha256", appSecret).update(raw).digest();
  const supplied = Buffer.from(signature.slice(7), "hex");
  if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied))
    throw new Error("Invalid webhook signature.");
  if (platform === "whatsapp") {
    const payload = JSON.parse(raw.toString("utf8"));
    if (payload.object !== "whatsapp_business_account" || !Array.isArray(payload.entry))
      throw new Error("Unsupported webhook object.");
    let ingested = 0;
    for (const entry of payload.entry) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "messages" || change.value?.messaging_product !== "whatsapp") continue;
        const value = change.value;
        const account = (await s.list<SocialAccount>("account")).find(
          (item) =>
            item.platform === "whatsapp" &&
            item.platformId === value.metadata?.phone_number_id &&
            item.connected &&
            item.executorId === s.store.environmentId,
        );
        if (!account) continue;
        if (account.connection !== "browser") {
          for (const status of (Array.isArray(value.statuses) ? value.statuses : []).slice(
            0,
            100,
          )) {
            const receipt = whatsappReceipt(status, s.now());
            if (receipt) await s.recordWhatsAppDelivery(account.id, receipt);
          }
        }
        const events: SocialInbound[] = [];
        for (const message of value.messages ?? []) {
          const at = Number(message.timestamp) * 1000;
          if (
            message.type !== "text" ||
            typeof message.text?.body !== "string" ||
            typeof message.id !== "string" ||
            typeof message.from !== "string" ||
            !/^\d{5,20}$/.test(message.from) ||
            !Number.isSafeInteger(at) ||
            at <= 0 ||
            at > s.now() + 60000
          )
            continue;
          const contact = (value.contacts ?? []).find(
            (item: { wa_id?: string }) => item.wa_id === message.from,
          );
          events.push({
            eventId: message.id,
            threadId: `participant:${message.from}`,
            contactId: message.from,
            contactName: String(contact?.profile?.name ?? message.from),
            kind: "message",
            text: message.text.body,
            at,
            replyUntil: at + 24 * 60 * 60000,
          });
        }
        ingested += await s.ingest(account.id, events);
      }
    }
    return { ingested };
  }
  const payload = JSON.parse(raw.toString("utf8")) as {
    object?: string;
    entry?: {
      id: string;
      messaging?: {
        sender: {
          id: string;
        };
        recipient?: {
          id: string;
        };
        timestamp: number;
        message?: {
          mid: string;
          text?: string;
          is_echo?: boolean;
        };
      }[];
      changes?: {
        field: string;
        value: {
          id?: string;
          comment_id?: string;
          post_id?: string;
          media?: {
            id: string;
          };
          message?: string;
          text?: string;
          created_time?: number;
          from?: {
            id: string;
            username?: string;
            name?: string;
          };
          item?: string;
          verb?: string;
        };
      }[];
    }[];
  };
  if (
    payload.object !== (platform === "instagram" ? "instagram" : "page") ||
    !Array.isArray(payload.entry)
  )
    throw new Error("Unsupported webhook object.");
  let ingested = 0;
  for (const entry of payload.entry) {
    const account = (await s.list<SocialAccount>("account")).find(
      (item) =>
        item.platform === platform &&
        item.platformId === entry.id &&
        item.connected &&
        item.executorId === s.store.environmentId,
    );
    if (!account) continue;
    const events: SocialInbound[] = [];
    for (const event of entry.messaging ?? [])
      if (
        event.message?.mid &&
        !event.message.is_echo &&
        event.sender.id !== entry.id &&
        (!event.recipient?.id || event.recipient.id === entry.id)
      )
        events.push({
          eventId: event.message.mid,
          threadId: `participant:${event.sender.id}`,
          contactId: event.sender.id,
          contactName: event.sender.id,
          kind: "message",
          text: event.message.text ?? "[Attachment]",
          at: event.timestamp,
          replyUntil: event.timestamp + 24 * 60 * 60000,
        });
    for (const change of entry.changes ?? [])
      if (
        change.field === "comments" ||
        (change.field === "feed" && change.value.item === "comment" && change.value.verb === "add")
      ) {
        const value = change.value;
        const eventId = value.comment_id ?? value.id;
        if (!eventId || !value.from?.id || value.from.id === entry.id) continue;
        events.push({
          eventId,
          threadId: eventId,
          postId: value.post_id ?? value.media?.id,
          contactId: value.from.id,
          contactName: value.from.name ?? value.from.username ?? value.from.id,
          kind: "comment",
          text: value.text ?? value.message ?? "[Attachment]",
          at: value.created_time ? value.created_time * 1000 : s.now(),
        });
      }
    ingested += await s.ingest(account.id, events);
  }
  return { ingested };
}

/**
 * Verifies and ingests one Telegram bot update. The route names the account; the request must carry the
 * secret derived from that account's stored bot token. Channel posts and non-text updates are ignored.
 */
export async function receiveTelegramWebhook(
  s: Pick<SocialService, "credentialFor" | "ingest" | "list" | "store">,
  accountId: string,
  raw: Buffer,
  secretHeader: unknown,
): Promise<{ ingested: number }> {
  const account = (await s.list<SocialAccount>("account")).find(
    (item) =>
      item.id === accountId &&
      item.platform === "telegram" &&
      item.accountType === "bot" &&
      item.connected &&
      item.executorId === s.store.environmentId,
  );
  if (!account) throw new Error("Telegram account is unknown.");
  const token = (await s.credentialFor(account.id))?.accessToken;
  if (!token || !verifyTelegramSecret(secretHeader, telegramWebhookSecret(token, account.id)))
    throw new Error("Invalid Telegram webhook secret.");
  const update = parseTelegramUpdate(JSON.parse(raw.toString("utf8")));
  if (!update) return { ingested: 0 };
  return { ingested: await s.ingest(account.id, [update.event]) };
}
