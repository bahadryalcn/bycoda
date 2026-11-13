import { afterEach, expect, it } from "vitest";
import { StoreDatabase } from "../../store-db";
import type { SocialService } from "../social";
import { listAssistantTelegramTargets } from "./assistant-telegram-targets";

const databases: StoreDatabase[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.close();
});

it("lists only actual personal Telegram conversations with current Assistant grants", async () => {
  const db = new StoreDatabase(":memory:");
  databases.push(db);
  await db.exec("CREATE TABLE social_records (kind TEXT,id TEXT,value TEXT,PRIMARY KEY(kind,id))");
  const account = {
    id: "telegram",
    platform: "telegram",
    name: "Owner bot",
    assistantGrant: { permissions: ["read", "draft"], version: "grant" },
  };
  const contact = { id: "contact", accountId: account.id, name: "Owner", optedOut: false };
  for (const thread of [
    {
      id: "personal",
      accountId: account.id,
      contactId: contact.id,
      kind: "message",
      lastInboundAt: 1,
    },
    {
      id: "project",
      accountId: account.id,
      contactId: contact.id,
      kind: "message",
      projectId: "project",
      lastInboundAt: 2,
    },
    {
      id: "comment",
      accountId: account.id,
      contactId: contact.id,
      kind: "comment",
      lastInboundAt: 3,
    },
    {
      id: "other",
      accountId: "another-host-account",
      contactId: contact.id,
      kind: "message",
      lastInboundAt: 4,
    },
  ])
    await db
      .prepare("INSERT INTO social_records VALUES ('thread',?,?)")
      .run(thread.id, JSON.stringify(thread));
  let granted = true;
  const social = {
    ready: Promise.resolve(),
    store: { db },
    list: async () => [account],
    get: async () => contact,
    assistantAccountProofsValid: async () => granted,
    capability: () => {},
  } as unknown as SocialService;
  expect(await listAssistantTelegramTargets(social, "global-room")).toEqual([
    {
      accountId: "telegram",
      accountLabel: "Owner bot",
      conversationId: "personal",
      conversationLabel: "Owner",
    },
  ]);
  granted = false;
  expect(await listAssistantTelegramTargets(social, "global-room")).toEqual([]);
  granted = true;
  contact.optedOut = true;
  expect(await listAssistantTelegramTargets(social, "global-room")).toEqual([]);
  expect(await listAssistantTelegramTargets(social, undefined)).toEqual([]);
});
