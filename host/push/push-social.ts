import { accountNeedsSignIn } from "../../src/features/social/model/accountSignIn";
import type { SocialAccountRequest } from "../../src/features/social/model/accountRequests";
import { SOCIAL_PLATFORM_NAMES, type SocialPlatform } from "../../src/features/social/model/social";
import type { NeedsHumanItem } from "../../src/features/social/model/socialActions";
import type { SocialPrincipal, SocialService } from "../social/social";
import type { StoreDatabase } from "../store-db";
import type { ExpoPushMessage } from "./expo-push";
import type { PushRecipient } from "./push-store";

/** One Social item that waits for the owner, reduced to what a push may carry. */
export type SocialPushItem = {
  /** Stable across reads: the dedupe key. A sign-in id carries the expiry value. */
  id: string;
  kind: "accountRequest" | "needsHuman" | "signIn";
  platform: SocialPlatform;
  reason?: NeedsHumanItem["reason"];
  at: number;
};

export type SocialPushSource = () => Promise<SocialPushItem[]>;

/** Older items are history, not news: a Host that was off for days does not replay them. */
export const SOCIAL_PUSH_MAX_AGE_MS = 24 * 60 * 60_000;

const OWNER: SocialPrincipal = { kind: "owner", actorId: "push", provider: "owner" };

/** What waits on this Host, read straight from the Social service as the owner. */
export function createSocialPushSource(
  social: Pick<SocialService, "call" | "accounts">,
  now: () => number = Date.now,
): SocialPushSource {
  return async () => {
    const items: SocialPushItem[] = [];
    const [requests, humans, accounts] = await Promise.all([
      social.call(OWNER, "accounts.requests.list", {}) as Promise<{
        items: SocialAccountRequest[];
      }>,
      social.call(OWNER, "browser.needsHuman.list", {}) as Promise<{ items: NeedsHumanItem[] }>,
      social.accounts(OWNER),
    ]);
    for (const request of requests.items)
      if (request.status === "pending")
        items.push({
          id: `request:${request.id}`,
          kind: "accountRequest",
          platform: request.platform,
          at: request.createdAt,
        });
    for (const human of humans.items)
      items.push({
        id: `human:${human.id}`,
        kind: "needsHuman",
        platform: human.platform,
        reason: human.reason,
        at: human.at,
      });
    for (const account of accounts)
      if (accountNeedsSignIn(account, now()) && account.expiresAt !== undefined)
        items.push({
          id: `signin:${account.id}:${account.expiresAt}`,
          kind: "signIn",
          platform: account.platform,
          at: account.expiresAt,
        });
    return items;
  };
}

/** The phone's "needs your input" choice gates these; there is no separate Social setting. */
export const socialPushAllowed = (recipient: PushRecipient): boolean => recipient.events.input;

/**
 * Privacy: the body is the recipient's own "needs your input" text. The platform and the reason
 * travel as data only; never a project, an account name or the AI's request text.
 */
export function socialPushMessage(
  recipient: PushRecipient,
  item: SocialPushItem,
  environmentId: string,
): ExpoPushMessage {
  return {
    to: recipient.pushToken,
    title: recipient.title,
    body: recipient.texts.input,
    data: {
      kind: "input",
      social: item.kind,
      platform: SOCIAL_PLATFORM_NAMES[item.platform],
      ...(item.reason ? { reason: item.reason } : {}),
      environmentId,
    },
    sound: "default",
    channelId: "bycoda",
    priority: "high",
  };
}

/** Remembers which phone already heard about which Social item, across Host restarts. */
export class SocialPushLedger {
  private ready: Promise<void> | undefined;

  constructor(private readonly db: StoreDatabase) {}

  prepare(): Promise<void> {
    this.ready ??= this.db.exec(
      `CREATE TABLE IF NOT EXISTS push_social_sent (
        device_hash TEXT NOT NULL,
        item_id TEXT NOT NULL,
        sent_at INTEGER NOT NULL,
        PRIMARY KEY (device_hash, item_id)
      )`,
    );
    return this.ready;
  }

  async sent(deviceHash: string, id: string): Promise<boolean> {
    await this.prepare();
    return !!(await this.db
      .prepare("SELECT 1 AS hit FROM push_social_sent WHERE device_hash=? AND item_id=?")
      .get(deviceHash, id));
  }

  /** True when this call claimed the item; written before sending so a failed send never replays. */
  async claim(deviceHash: string, id: string, at: number): Promise<boolean> {
    await this.prepare();
    const result = await this.db
      .prepare(
        "INSERT OR IGNORE INTO push_social_sent (device_hash, item_id, sent_at) VALUES (?,?,?)",
      )
      .run(deviceHash, id, at);
    return Number(result.changes) === 1;
  }
}
