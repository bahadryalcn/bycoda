import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "./store";
import { SocialService, type SocialPrincipal } from "./social";
import { SocialTokenConnections } from "./social-token-connections";
import { SocialHttp } from "../src/integrations/social/adapter";
import { createSocialAdapters } from "../src/integrations/social/platformAdapters";
import type { SocialCredential } from "./social-credentials";
import type { SocialAccount, SocialCampaign, SocialJob } from "../src/features/social/model/social";

const owner: SocialPrincipal = { kind: "owner", actorId: "device", provider: "owner" };
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});

async function fixture(
  options: {
    platform?: "telegram" | "whatsapp";
    type?: "channel" | "bot" | "member" | "business";
    approved?: boolean;
  } = {},
) {
  const path = mkdtempSync(join(tmpdir(), "social-token-channel-"));
  const store = new HostStore(join(path, "host.db"));
  const project = await store.addProject(path, "Project");
  const clock = { value: 1_800_000_000_000 };
  const state = {
    bot: { id: 123, is_bot: true, username: "bycoda_bot" } as Record<string, any>,
    chat: {
      id: -1001234567890,
      type: "channel",
      title: "Bycoda",
      username: "bycodaofficial",
    } as Record<string, any>,
    member: {
      status: "administrator",
      user: { id: 123, is_bot: true },
      can_post_messages: true,
    } as Record<string, any>,
    webhook: "https://existing-owner.example/webhook",
    onCall: undefined as undefined | ((method: string) => Promise<void>),
    throwNetwork: false,
  };
  const requests: { method: string; body: Record<string, unknown> | FormData }[] = [];
  const http = new SocialHttp(async (raw, options) => {
    const url = new URL(String(raw));
    const method = url.pathname.split("/").at(-1)!;
    const body =
      options?.body instanceof FormData ? options.body : JSON.parse(String(options?.body ?? "{}"));
    requests.push({ method, body });
    await state.onCall?.(method);
    if (state.throwNetwork) throw new Error("Network failure with synthetic-secret");
    if (url.hostname === "graph.facebook.com")
      return Response.json({ id: "456", verified_name: "Bycoda Business" });
    let result: unknown;
    if (method === "getMe") result = state.bot;
    else if (method === "getChat") result = state.chat;
    else if (method === "getChatMember") result = state.member;
    else if (method === "getWebhookInfo") result = { url: state.webhook };
    else if (method === "sendPhoto")
      result = {
        message_id: 77,
        chat: { id: state.chat.id, type: "channel" },
        caption: (body as FormData).get("caption") ?? "",
        photo: [{ file_id: "photo-receipt" }],
      };
    else if (method === "sendMessage")
      result = {
        message_id: 77,
        chat: { id: state.chat.id, type: "channel" },
        text: (body as Record<string, unknown>).text,
      };
    else throw new Error(`Unexpected method ${method}`);
    return Response.json({ ok: true, result });
  });
  const tokens = new Map<string, SocialCredential>();
  const vault = {
    get: vi.fn(async (id: string) => tokens.get(id)),
    set: vi.fn(async (id: string, value: SocialCredential) => {
      tokens.set(id, value);
    }),
    delete: vi.fn(async (id: string) => {
      tokens.delete(id);
    }),
  };
  const social = new SocialService(
    store,
    vault,
    createSocialAdapters(http),
    path,
    undefined,
    () => clock.value,
  );
  cleanup.push(async () => {
    await social.dispose();
    await store.close();
    rmSync(path, { recursive: true, force: true });
  });
  const account = (await social.call(owner, "accounts.create", {
    platform: options.platform ?? "telegram",
    accountType: options.type ?? "channel",
    name: "Pending",
    projectIds: [project.id],
    connection: "token",
  })) as SocialAccount;
  const env: NodeJS.ProcessEnv = {
    BYCODA_SOCIAL_TELEGRAM_TOKEN: "123:synthetic-secret",
    BYCODA_SOCIAL_TELEGRAM_APPROVED: options.approved === false ? "0" : "1",
    BYCODA_SOCIAL_WHATSAPP_TOKEN: "synthetic-business-secret",
    BYCODA_SOCIAL_WHATSAPP_PHONE_NUMBER_ID: "456",
    BYCODA_SOCIAL_WHATSAPP_APPROVED: "1",
  };
  const connections = new SocialTokenConnections(social, env, http, () => clock.value);
  const inspect = (target = "@bycodaofficial", p = owner) =>
    connections.inspectTelegramChannel(p, account.id, target);
  return {
    store,
    social,
    project,
    account,
    clock,
    state,
    requests,
    http,
    tokens,
    vault,
    env,
    connections,
    inspect,
  };
}

it("reviews an existing channel without storing credentials, then binds the channel and bot once", async () => {
  const f = await fixture();
  const review = await f.inspect();
  expect(review).toMatchObject({
    channelId: "-1001234567890",
    channelName: "Bycoda",
    username: "bycodaofficial",
    botId: "123",
    botName: "@bycoda_bot",
    expiresAt: f.clock.value + 120000,
  });
  expect(JSON.stringify(review)).not.toContain("synthetic-secret");
  expect(f.tokens.size).toBe(0);
  expect(f.requests.map((r) => r.method)).toEqual(["getMe", "getChat", "getChatMember"]);
  const connected = await f.connections.connect(owner, f.account.id, review.reviewId);
  expect(connected).toMatchObject({
    platformId: review.channelId,
    telegramBotId: "123",
    accountType: "channel",
    connection: "token",
    scopes: ["channel.publish"],
    accessApproved: true,
    connected: true,
  });
  expect(f.tokens.get(f.account.id)?.accessToken).toBe(f.env.BYCODA_SOCIAL_TELEGRAM_TOKEN);
  expect(f.requests.filter((r) => r.method === "getChat").at(-1)?.body).toEqual({
    chat_id: review.channelId,
  });
  await expect(f.connections.connect(owner, f.account.id, review.reviewId)).rejects.toThrow(
    "Inspect and review",
  );
});
it("supports private numeric channels without inventing a username or requiring a new phone identity", async () => {
  const f = await fixture();
  delete f.state.chat.username;
  const review = await f.inspect("-1001234567890");
  expect(review.username).toBeUndefined();
  expect(await f.connections.connect(owner, f.account.id, review.reviewId)).toMatchObject({
    platformId: review.channelId,
    telegramBotId: "123",
  });
});
it("requires owner authority for inspection and confirmation", async () => {
  const f = await fixture();
  const session: SocialPrincipal = { ...owner, kind: "session", sessionId: "untrusted" };
  await expect(f.inspect("@bycodaofficial", session)).rejects.toThrow("owner");
  await expect(f.connections.connect(session, f.account.id, "forged-review")).rejects.toThrow(
    "owner",
  );
  expect(f.requests).toHaveLength(0);
  expect(f.tokens.size).toBe(0);
});
it("binds review to owner identity and consumes the same review at most once concurrently", async () => {
  const f = await fixture();
  const review = await f.inspect();
  await expect(
    f.connections.connect({ ...owner, actorId: "another-device" }, f.account.id, review.reviewId),
  ).rejects.toThrow("Inspect and review");
  const results = await Promise.allSettled([
    f.connections.connect(owner, f.account.id, review.reviewId),
    f.connections.connect(owner, f.account.id, review.reviewId),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(f.vault.set).toHaveBeenCalledTimes(1);
});
it.each(["expired", "token", "account", "executor", "stopped"])(
  "rejects a %s review before credential storage",
  async (change) => {
    const f = await fixture();
    const review = await f.inspect();
    if (change === "expired") f.clock.value += 120000;
    if (change === "token") f.env.BYCODA_SOCIAL_TELEGRAM_TOKEN = "123:rotated-secret";
    if (change === "account")
      await f.social.call(owner, "accounts.grants", {
        accountId: f.account.id,
        projectId: f.project.id,
        permissions: ["read", "draft", "publish"],
      });
    if (change === "executor")
      await f.social.call(owner, "accounts.executor", {
        accountId: f.account.id,
        executorId: "different-host",
      });
    if (change === "stopped") await f.social.call(owner, "execution.stop", { stopped: true });
    await expect(f.connections.connect(owner, f.account.id, review.reviewId)).rejects.toThrow();
    expect(f.vault.set).not.toHaveBeenCalled();
    expect(f.tokens.size).toBe(0);
  },
);
it("requires the latest review for the same account and rejects another account's review", async () => {
  const f = await fixture();
  const old = await f.inspect();
  const latest = await f.inspect();
  await expect(f.connections.connect(owner, f.account.id, old.reviewId)).rejects.toThrow(
    "Inspect and review",
  );
  const other = (await f.social.call(owner, "accounts.create", {
    platform: "telegram",
    accountType: "channel",
    name: "Other",
    projectIds: [f.project.id],
    connection: "token",
  })) as SocialAccount;
  await expect(f.connections.connect(owner, other.id, latest.reviewId)).rejects.toThrow(
    "Inspect and review",
  );
  expect(f.tokens.size).toBe(0);
});
it("does not revive a pending review after disconnect and unpause restore visible account fields", async () => {
  const f = await fixture();
  const review = await f.inspect();
  await f.social.call(owner, "accounts.disconnect", { accountId: f.account.id });
  await f.social.call(owner, "accounts.pause", { accountId: f.account.id, paused: false });
  await expect(f.connections.connect(owner, f.account.id, review.reviewId)).rejects.toThrow(
    "review expired or changed",
  );
  expect(f.vault.set).not.toHaveBeenCalled();
});
it.each(["bot", "chat-type", "chat-id", "member-id", "member-role", "posting-right"])(
  "rejects mismatched provider proof: %s",
  async (change) => {
    const f = await fixture();
    if (change === "bot") f.state.bot.is_bot = false;
    if (change === "chat-type") f.state.chat.type = "supergroup";
    if (change === "chat-id") f.state.chat.id = "-1001234567890";
    if (change === "member-id") f.state.member.user.id = 999;
    if (change === "member-role") f.state.member.status = "member";
    if (change === "posting-right") f.state.member.can_post_messages = false;
    await expect(f.inspect()).rejects.toThrow("Telegram channel verification failed");
    expect(f.tokens.size).toBe(0);
    expect(f.vault.set).not.toHaveBeenCalled();
  },
);
it("verifies the entered username or numeric target instead of accepting an unrelated channel response", async () => {
  const f = await fixture();
  await expect(f.inspect("@someoneelse")).rejects.toThrow("verification failed");
  await expect(f.inspect("-1009999999999")).rejects.toThrow("verification failed");
  for (const target of ["https://t.me/bycodaofficial", "-001", "123", "-9007199254740992"])
    await expect(f.inspect(target)).rejects.toThrow("channel ID");
});
it.each(["posting-right", "bot", "channel-name"])(
  "revalidates the reviewed provider proof on confirmation: %s",
  async (change) => {
    const f = await fixture();
    const review = await f.inspect();
    if (change === "posting-right") f.state.member.can_post_messages = false;
    if (change === "bot") {
      f.state.bot.id = 999;
      f.state.member.user.id = 999;
    }
    if (change === "channel-name") f.state.chat.title = "Changed after review";
    await expect(f.connections.connect(owner, f.account.id, review.reviewId)).rejects.toThrow();
    expect(f.tokens.size).toBe(0);
  },
);
it("rechecks native state and token after network verification but before storing credentials", async () => {
  const f = await fixture();
  const review = await f.inspect();
  f.state.onCall = async (method) => {
    if (method === "getChatMember")
      f.env.BYCODA_SOCIAL_TELEGRAM_TOKEN = "123:changed-during-verification";
  };
  await expect(f.connections.connect(owner, f.account.id, review.reviewId)).rejects.toThrow(
    "review expired or changed",
  );
  expect(f.vault.set).not.toHaveBeenCalled();
});
it("rechecks the owner review after asynchronous credential storage before commit", async () => {
  const f = await fixture();
  const review = await f.inspect();
  f.vault.set.mockImplementationOnce(async (id, value) => {
    f.tokens.set(id, value);
    await f.social.call(owner, "accounts.pause", { accountId: id, paused: true });
  });
  await expect(f.connections.connect(owner, f.account.id, review.reviewId)).rejects.toThrow(
    "paused",
  );
  expect(f.tokens.size).toBe(0);
  expect((await f.social.accountForOAuth(owner, f.account.id)).connected).toBe(false);
});
it("preserves an existing channel credential when a fresh native pause rejects reconnect after vault I/O", async () => {
  const f = await fixture();
  const first = await f.inspect();
  await f.connections.connect(owner, f.account.id, first.reviewId);
  const previous = { accessToken: "123:previous-verified-token" };
  f.tokens.set(f.account.id, previous);
  const review = await f.inspect();
  f.vault.set.mockImplementationOnce(async (id, value) => {
    f.tokens.set(id, value);
    await f.social.call(owner, "accounts.pause", { accountId: id, paused: true });
  });
  await expect(f.connections.connect(owner, f.account.id, review.reviewId)).rejects.toThrow(
    "paused",
  );
  expect(f.tokens.get(f.account.id)).toEqual(previous);
  expect(await f.social.accountForOAuth(owner, f.account.id)).toMatchObject({
    connected: true,
    paused: true,
  });
});
it("keeps the channel's bot binding immutable and rejects metadata on old bot accounts", async () => {
  const f = await fixture();
  const review = await f.inspect();
  await f.connections.connect(owner, f.account.id, review.reviewId);
  await expect(
    f.social.connectAccount(
      f.account.id,
      {
        platformId: review.channelId,
        name: "Bycoda",
        telegramBotId: "999",
        scopes: ["channel.publish"],
        connection: "token",
        accessApproved: true,
      },
      { accessToken: "999:other" },
    ),
  ).rejects.toThrow("preserve the Telegram bot");
  const bot = await fixture({ type: "bot" });
  await expect(
    bot.social.connectAccount(
      bot.account.id,
      {
        platformId: "123",
        name: "Bot",
        telegramBotId: "123",
        scopes: ["bot.send"],
        connection: "token",
        accessApproved: true,
      },
      { accessToken: "123:other" },
    ),
  ).rejects.toThrow("binding belongs");
  expect(bot.tokens.size).toBe(0);
});
it("rejects malformed channel metadata and widened scopes before vault writes", async () => {
  const f = await fixture();
  const identity = {
    platformId: "-1001234567890",
    name: "Bycoda",
    telegramBotId: "123",
    scopes: ["channel.publish"],
    connection: "token" as const,
    accessApproved: true,
  };
  for (const change of [
    { telegramBotId: undefined },
    { telegramBotId: "00123" },
    { platformId: "1001234567890" },
    { connection: "browser" as const },
    { scopes: ["channel.publish", "bot.poll"] },
  ])
    await expect(
      f.social.connectAccount(
        f.account.id,
        { ...identity, ...change },
        { accessToken: "123:synthetic-secret" },
      ),
    ).rejects.toThrow("Invalid Telegram channel");
  expect(f.vault.set).not.toHaveBeenCalled();
});
it("preserves existing bot/webhook and WhatsApp business token connection behavior", async () => {
  const bot = await fixture({ type: "bot" });
  expect(await bot.connections.connect(owner, bot.account.id)).toMatchObject({
    platformId: "123",
    accountType: "bot",
    scopes: ["bot.send"],
  });
  expect(bot.requests.map((r) => r.method)).toEqual(["getMe", "getWebhookInfo"]);
  const business = await fixture({ platform: "whatsapp", type: "business" });
  expect(await business.connections.connect(owner, business.account.id)).toMatchObject({
    platformId: "456",
    scopes: ["whatsapp_business_messaging"],
  });
});
it("withholds configured access approval and never exposes raw provider failures", async () => {
  const f = await fixture({ approved: false });
  const review = await f.inspect();
  expect(await f.connections.connect(owner, f.account.id, review.reviewId)).toMatchObject({
    accessApproved: false,
  });
  const failed = await fixture();
  failed.state.throwNetwork = true;
  await expect(failed.inspect()).rejects.toThrow("Telegram channel verification failed");
  try {
    await failed.inspect();
  } catch (error) {
    expect(String(error)).not.toContain("synthetic-secret");
  }
});
it("carries image-only channel campaigns through exact approval, caption revision and real adapter dispatch", async () => {
  const f = await fixture();
  const review = await f.inspect();
  await f.connections.connect(owner, f.account.id, review.reviewId);
  await f.social.call(owner, "accounts.grants", {
    accountId: f.account.id,
    projectId: f.project.id,
    permissions: ["read", "draft", "publish"],
  });
  const image = await f.social.uploadImage(
    owner,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zll1sAAAAASUVORK5CYII=",
      "base64",
    ).toString("base64"),
  );
  const create = {
    name: "Channel publication",
    projectIds: [f.project.id],
    variants: [
      {
        accountId: f.account.id,
        text: "",
        media: [{ kind: "image", uploadId: image.uploadId }],
        factIds: [],
        scheduledAt: f.clock.value,
      },
    ],
  };
  const campaign = (await f.social.call(owner, "campaigns.create", create)) as SocialCampaign;
  await f.social.call(owner, "campaigns.approveReviewed", {
    id: campaign.id,
    expectedRevision: campaign.revision,
  });
  expect(
    ((await f.social.call(owner, "campaigns.preview", { id: campaign.id })) as any).targets[0],
  ).toMatchObject({ approved: true, contentError: undefined });
  const edited = (await f.social.call(owner, "campaigns.create", {
    ...create,
    id: campaign.id,
    expectedRevision: campaign.revision,
    variants: [{ ...create.variants[0], text: "Reviewed caption" }],
  })) as SocialCampaign;
  expect(
    ((await f.social.call(owner, "campaigns.preview", { id: edited.id })) as any).targets[0]
      .approved,
  ).toBe(false);
  await expect(f.social.call(owner, "campaigns.schedule", { id: edited.id })).rejects.toThrow(
    "approv",
  );
  await f.social.call(owner, "campaigns.approveReviewed", {
    id: edited.id,
    expectedRevision: edited.revision,
  });
  await f.social.call(owner, "execution.enable", { confirm: "ENABLE_EXTERNAL_SENDS" });
  const jobs = (await f.social.call(owner, "campaigns.schedule", { id: edited.id })) as SocialJob[];
  await f.social.call(owner, "inbox.polling", { enabled: true });
  await f.social.tick();
  const saved = (await f.social.snapshot(owner)).jobs.find((job) => job.id === jobs[0].id)!;
  expect(saved).toMatchObject({
    status: "succeeded",
    platformId: "-1001234567890:77",
    kind: "publish",
    payload: { text: "Reviewed caption" },
  });
  const submitted = f.requests.filter((r) => r.method === "sendPhoto");
  expect(submitted).toHaveLength(1);
  expect((submitted[0].body as FormData).get("chat_id")).toBe("-1001234567890");
  expect((submitted[0].body as FormData).get("caption")).toBe("Reviewed caption");
  expect(f.requests.some((r) => r.method === "getUpdates" || r.method === "getWebhookInfo")).toBe(
    false,
  );
  expect(
    await f.store.db
      .prepare("SELECT value FROM social_settings WHERE key=?")
      .get(`pollRate:${f.account.id}`),
  ).toBeUndefined();
});
it("dispatches an approved channel photo with no caption and does not treat empty text-only content as valid", async () => {
  const f = await fixture();
  const review = await f.inspect();
  await f.connections.connect(owner, f.account.id, review.reviewId);
  await f.social.call(owner, "accounts.grants", {
    accountId: f.account.id,
    projectId: f.project.id,
    permissions: ["read", "draft", "publish"],
  });
  const image = await f.social.uploadImage(
    owner,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zll1sAAAAASUVORK5CYII=",
      "base64",
    ).toString("base64"),
  );
  const variant = {
    accountId: f.account.id,
    text: "",
    media: [{ kind: "image", uploadId: image.uploadId }],
    factIds: [],
    scheduledAt: f.clock.value,
  };
  await expect(
    f.social.call(owner, "campaigns.create", {
      name: "Invalid",
      projectIds: [f.project.id],
      variants: [{ ...variant, media: [] }],
    }),
  ).rejects.toThrow("campaign text");
  const campaign = (await f.social.call(owner, "campaigns.create", {
    name: "Photo only",
    projectIds: [f.project.id],
    variants: [variant],
  })) as SocialCampaign;
  await f.social.call(owner, "campaigns.approveReviewed", {
    id: campaign.id,
    expectedRevision: campaign.revision,
  });
  await f.social.call(owner, "execution.enable", { confirm: "ENABLE_EXTERNAL_SENDS" });
  const jobs = (await f.social.call(owner, "campaigns.schedule", {
    id: campaign.id,
  })) as SocialJob[];
  await f.social.tick();
  expect((await f.social.snapshot(owner)).jobs.find((job) => job.id === jobs[0].id)).toMatchObject({
    status: "succeeded",
    payload: { text: "" },
  });
  const sent = f.requests.find((r) => r.method === "sendPhoto")!;
  expect((sent.body as FormData).has("caption")).toBe(false);
});
