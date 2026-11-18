import { createHmac } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import type { SocialAccount } from "../../../src/features/social/model/social";
import type { SocialInbound } from "../../../src/integrations/social/adapter";
import { StoreDatabase } from "../../store-db";
import type { SocialServiceInternals } from "../core/social-internals";
import { readInstagramMentions, recordInstagramMention } from "./instagram-mentions";
import { receiveWebhook } from "./social-webhooks";

const ENDPOINT_SECRET = "fixture-webhook";
const NOW = 1_800_000_000_000;
const account = {
  id: "instagram-connection",
  platform: "instagram",
  platformId: "178123",
  connected: true,
  executorId: "host",
} as SocialAccount;

const databases: StoreDatabase[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.close();
});

async function fixture() {
  const db = new StoreDatabase(":memory:");
  databases.push(db);
  await db.exec("CREATE TABLE social_records (kind TEXT,id TEXT,value TEXT,PRIMARY KEY(kind,id))");
  const ingest = vi.fn(async (_accountId: string, events: SocialInbound[]) => events.length);
  const s = {
    list: vi.fn(async () => [account]),
    store: { db, environmentId: "host" },
    now: () => NOW,
    ingest,
  } as unknown as SocialServiceInternals;
  const send = (entries: object[], secret = ENDPOINT_SECRET) => {
    const raw = Buffer.from(JSON.stringify({ object: "instagram", entry: entries }));
    const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
    return receiveWebhook(s, "instagram", raw, signature, ENDPOINT_SECRET);
  };
  return { send, ingest, store: s.store };
}

it("normalizes Instagram Login live comments with their original reply targets", async () => {
  const f = await fixture();
  const value = {
    id: "123",
    from: { id: "456", username: "viewer" },
    text: "Hi",
    media: { id: "789" },
  };
  await expect(
    f.send([{ id: account.platformId, field: "live_comments", value }]),
  ).resolves.toEqual({
    ingested: 1,
  });
  expect(f.ingest.mock.calls[0]?.[1]).toEqual([
    {
      eventId: "123",
      threadId: "123",
      postId: "789",
      contactId: "456",
      contactName: "viewer",
      kind: "comment",
      instagramSource: "live_comment",
      text: "Hi",
      at: NOW,
    },
  ]);
});

it("deduplicates signed mentions and keeps senderless events out of the replyable inbox", async () => {
  const f = await fixture();
  const entries = [
    {
      id: account.platformId,
      time: NOW / 1000,
      changes: [
        { field: "mentions", value: { media_id: "200" } },
        { field: "mentions", value: { media_id: "200", comment_id: "300" } },
        { field: "mentions", value: { media_id: "bad" } },
      ],
    },
  ];
  await expect(f.send(entries, "invalid")).rejects.toThrow("Invalid webhook signature.");
  await expect(f.send(entries)).resolves.toEqual({ ingested: 2 });
  await expect(f.send(entries)).resolves.toEqual({ ingested: 0 });
  expect(f.ingest.mock.calls.every(([, events]) => events.length === 0)).toBe(true);
  await expect(readInstagramMentions(f.store, account.id)).resolves.toEqual({
    coverage: "webhook_only",
    mentions: [
      { mediaId: "200", commentId: "300", at: NOW },
      { mediaId: "200", at: NOW },
    ],
  });
  await expect(readInstagramMentions(f.store, "different-account")).resolves.toEqual({
    coverage: "webhook_only",
    mentions: [],
  });
});

it("reads an explicit account page without losing the continuation", async () => {
  const f = await fixture();
  for (let i = 1; i <= 26; i++)
    await recordInstagramMention(f.store, account.id, { mediaId: String(i), at: NOW });
  const page = await readInstagramMentions(f.store, account.id);
  expect(page.mentions.map((mention) => mention.mediaId)).toEqual(
    Array.from({ length: 25 }, (_, offset) => String(26 - offset)),
  );
  expect(page.next).toBeDefined();
  expect((await readInstagramMentions(f.store, account.id, page.next)).mentions).toEqual([
    { mediaId: "1", at: NOW },
  ]);
  await expect(readInstagramMentions(f.store, account.id, "invalid")).rejects.toThrow("cursor");
});
