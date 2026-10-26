import { describe, expect, it, vi } from "vitest";
import type { SocialAccount, SocialJob, SocialMedia } from "../../features/social/model/social";
import { SocialHttp, SocialPlatformError } from "./adapter";
import { createTelegramChannelAdapter, telegramChannelContentIssue } from "./telegramChannel";

const channelId = "-1001234567890";
const account = (): SocialAccount => ({
  id: "channel",
  platform: "telegram",
  platformId: channelId,
  telegramBotId: "123",
  name: "Bycoda channel",
  accountType: "channel",
  connection: "token",
  scopes: ["channel.publish"],
  connected: true,
  accessApproved: true,
  paused: false,
  executorId: "host",
  grants: {},
  createdAt: 1,
});
const job = (): SocialJob => ({
  id: "job",
  operationId: "op",
  dedupeKey: "key",
  accountId: "channel",
  projectIds: ["project"],
  provider: "owner",
  actorId: "owner",
  kind: "publish",
  payload: { text: "Reviewed channel post", media: [] },
  status: "running",
  scheduledAt: 1,
  attempts: 1,
  createdAt: 1,
});
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const jpeg = new Uint8Array([255, 216, 255, 0]);
const video = new Uint8Array([0, 0, 0, 12, 102, 116, 121, 112, 105, 115, 111, 109]);
type Responses = Partial<
  Record<"getMe" | "getChat" | "getChatMember" | "sendMessage" | "sendPhoto" | "sendVideo", unknown>
>;
function fixture(responses: Responses = {}) {
  const defaults: Responses = {
    getMe: { id: 123, is_bot: true },
    getChat: { id: Number(channelId), type: "channel", username: "bycodaofficial" },
    getChatMember: {
      user: { id: 123, is_bot: true },
      status: "administrator",
      can_post_messages: true,
    },
    sendMessage: {
      message_id: 7,
      chat: { id: Number(channelId), type: "channel" },
      text: "Reviewed channel post",
    },
    sendPhoto: {
      message_id: 8,
      chat: { id: Number(channelId), type: "channel" },
      caption: "Reviewed channel post",
      photo: [{ file_id: "photo-id" }],
    },
    sendVideo: {
      message_id: 9,
      chat: { id: Number(channelId), type: "channel" },
      caption: "Reviewed channel post",
      video: { file_id: "video-id" },
    },
  };
  const fetcher = vi.fn(async (raw: string | URL | Request, _init?: RequestInit) => {
    const method = String(raw).split("/").at(-1)!;
    return Response.json({
      ok: true,
      result:
        method in responses
          ? responses[method as keyof Responses]
          : defaults[method as keyof Responses],
    });
  });
  return {
    fetcher,
    adapter: createTelegramChannelAdapter(new SocialHttp(fetcher)),
    methods: () => fetcher.mock.calls.map(([raw]) => String(raw).split("/").at(-1)),
  };
}
describe("Telegram channel publishing", () => {
  it("rechecks exact bot, channel and administrator rights before final owner approval and publication", async () => {
    const f = fixture();
    const guard = vi.fn(async () => {
      expect(f.methods()).toEqual(["getMe", "getChat", "getChatMember"]);
    });
    expect(
      await f.adapter.send(account(), job(), "123:synthetic", async () => png, undefined, guard),
    ).toEqual({ platformId: `${channelId}:7`, url: "https://t.me/bycodaofficial/7" });
    expect(guard).toHaveBeenCalledOnce();
    expect(f.methods()).toEqual(["getMe", "getChat", "getChatMember", "sendMessage"]);
    expect(JSON.parse(f.fetcher.mock.calls[2]![1]!.body as string)).toEqual({
      chat_id: channelId,
      user_id: 123,
    });
    expect(JSON.parse(f.fetcher.mock.calls[3]![1]!.body as string)).toEqual({
      chat_id: channelId,
      text: "Reviewed channel post",
    });
  });
  it.each([
    ["image", png, "sendPhoto", "photo", "image/png"],
    ["image", jpeg, "sendPhoto", "photo", "image/jpeg"],
    ["video", video, "sendVideo", "video", "video/mp4"],
  ] as const)(
    "sends reviewed uploaded %s using multipart only after fresh rights checks",
    async (kind, bytes, method, field, mime) => {
      const f = fixture();
      const publish = job();
      publish.payload.media = [{ kind, uploadId: "owned-upload" }];
      const read = vi.fn(async () => {
        expect(f.fetcher).not.toHaveBeenCalled();
        return bytes;
      });
      await expect(
        f.adapter.send(account(), publish, "123:synthetic", read),
      ).resolves.toMatchObject({ platformId: `${channelId}:${kind === "image" ? 8 : 9}` });
      expect(read).toHaveBeenCalledExactlyOnceWith("owned-upload");
      expect(f.methods()).toEqual(["getMe", "getChat", "getChatMember", method]);
      const init = f.fetcher.mock.calls[3]![1]!;
      expect(init.headers).toBeUndefined();
      expect(init.body).toBeInstanceOf(FormData);
      const body = init.body as FormData;
      expect(body.get("chat_id")).toBe(channelId);
      expect(body.get("caption")).toBe("Reviewed channel post");
      expect((body.get(field) as Blob).type).toBe(mime);
    },
  );
  it("accepts an image-only post and never fabricates a private channel URL", async () => {
    const f = fixture({
      getChat: { id: Number(channelId), type: "channel" },
      sendPhoto: {
        message_id: 8,
        chat: { id: Number(channelId), type: "channel" },
        photo: [{ file_id: "photo-id" }],
      },
    });
    const publish = job();
    publish.payload.text = "";
    publish.payload.media = [{ kind: "image", uploadId: "photo" }];
    expect(await f.adapter.send(account(), publish, "123:synthetic", async () => png)).toEqual({
      platformId: `${channelId}:8`,
    });
    expect((f.fetcher.mock.calls[3]![1]!.body as FormData).has("caption")).toBe(false);
  });
  it.each([
    { getMe: { id: 456, is_bot: true } },
    { getMe: { id: 123, is_bot: false } },
    { getChat: { id: -100999, type: "channel" } },
    { getChat: { id: Number(channelId), type: "supergroup" } },
    {
      getChatMember: {
        user: { id: 123, is_bot: true },
        status: "administrator",
        can_post_messages: false,
      },
    },
    {
      getChatMember: {
        user: { id: 456, is_bot: true },
        status: "administrator",
        can_post_messages: true,
      },
    },
    {
      getChatMember: { user: { id: 123, is_bot: true }, status: "member", can_post_messages: true },
    },
  ])("does not dispatch when current bot/channel/rights differ: %j", async (responses) => {
    const f = fixture(responses);
    const guard = vi.fn();
    await expect(
      f.adapter.send(account(), job(), "123:synthetic", async () => png, undefined, guard),
    ).rejects.toMatchObject({ code: "denied" });
    expect(f.methods().some((method) => method?.startsWith("send"))).toBe(false);
    expect(guard).not.toHaveBeenCalled();
  });
  it("Stop or revoked owner permission after preflight prevents transmission", async () => {
    const f = fixture();
    await expect(
      f.adapter.send(
        account(),
        job(),
        "123:synthetic",
        async () => png,
        undefined,
        async () => {
          throw new SocialPlatformError("denied");
        },
      ),
    ).rejects.toMatchObject({ code: "denied" });
    expect(f.methods()).toEqual(["getMe", "getChat", "getChatMember"]);
  });
  it.each([
    {
      message_id: 0,
      chat: { id: Number(channelId), type: "channel" },
      text: "Reviewed channel post",
    },
    { message_id: 7, chat: { id: -999, type: "channel" }, text: "Reviewed channel post" },
    {
      message_id: 7,
      chat: { id: Number(channelId), type: "group" },
      text: "Reviewed channel post",
    },
    { message_id: 7, chat: { id: Number(channelId), type: "channel" }, text: "Other message" },
    {},
  ])("holds uncertain acknowledgements without retry: %j", async (receipt) => {
    const f = fixture({ sendMessage: receipt });
    await expect(
      f.adapter.send(account(), job(), "123:synthetic", async () => png),
    ).rejects.toMatchObject({ code: "unknown" });
    expect(f.methods().filter((method) => method === "sendMessage")).toHaveLength(1);
  });
  it.each(["image", "video"] as const)("holds a missing %s media acknowledgement", async (kind) => {
    const method = kind === "image" ? "sendPhoto" : "sendVideo";
    const f = fixture({
      [method]: {
        message_id: 8,
        chat: { id: Number(channelId), type: "channel" },
        caption: "Reviewed channel post",
      },
    });
    const publish = job();
    publish.payload.media = [{ kind, uploadId: "media" }];
    await expect(
      f.adapter.send(account(), publish, "123:synthetic", async () =>
        kind === "image" ? png : video,
      ),
    ).rejects.toMatchObject({ code: "unknown" });
    expect(f.methods().filter((m) => m === method)).toHaveLength(1);
  });
  it.each(["@bycoda", "-01001234567890", "0", "-9007199254740992"])(
    "requires canonical safe numeric channel identity: %s",
    async (id) => {
      const f = fixture();
      await expect(
        f.adapter.send({ ...account(), platformId: id }, job(), "123:synthetic", async () => png),
      ).rejects.toMatchObject({ code: "unsupported" });
      expect(f.fetcher).not.toHaveBeenCalled();
    },
  );
  it.each(["", "00123", "-123", "9007199254740992"])(
    "requires a canonical immutable bot identity: %s",
    async (id) => {
      const f = fixture();
      await expect(
        f.adapter.send(
          { ...account(), telegramBotId: id },
          job(),
          "123:synthetic",
          async () => png,
        ),
      ).rejects.toMatchObject({ code: "unsupported" });
      expect(f.fetcher).not.toHaveBeenCalled();
    },
  );
  it("does not consume getUpdates or expose channel direct messages", async () => {
    const f = fixture();
    await expect(f.adapter.poll(account(), "123:synthetic", [])).rejects.toMatchObject({
      code: "unsupported",
    });
    expect(f.fetcher).not.toHaveBeenCalled();
    const publish = job();
    publish.kind = "message";
    expect(telegramChannelContentIssue(account(), publish)).toContain("publishing only");
  });
  it.each([
    ["image", new Uint8Array(5 * 1024 * 1024 + 1)],
    ["video", new Uint8Array(50 * 1024 * 1024 + 1)],
    ["image", video],
    ["video", png],
  ] as const)(
    "rejects invalid or oversized uploaded %s before network access",
    async (kind, bytes) => {
      const f = fixture();
      const publish = job();
      publish.payload.media = [{ kind, uploadId: "media" }];
      await expect(
        f.adapter.send(account(), publish, "123:synthetic", async () => bytes),
      ).rejects.toMatchObject({ code: "rejected" });
      expect(f.fetcher).not.toHaveBeenCalled();
    },
  );
  it("counts combined plain text and captions in UTF-16 including links", () => {
    const publish = job();
    publish.payload.text = "😀".repeat(2048);
    expect(telegramChannelContentIssue(account(), publish)).toBeUndefined();
    publish.payload.link = "https://example.test";
    expect(telegramChannelContentIssue(account(), publish)).toContain("4096");
    publish.payload.text = "😀".repeat(512);
    publish.payload.link = undefined;
    publish.payload.media = [{ kind: "image", uploadId: "image" }];
    expect(telegramChannelContentIssue(account(), publish)).toBeUndefined();
    publish.payload.text += "!";
    expect(telegramChannelContentIssue(account(), publish)).toContain("1024");
  });
  it.each([
    { kind: "image", url: "https://example.test/image.png" },
    { kind: "document", uploadId: "doc" },
    { kind: "image", uploadId: "image", alt: "Not supported" },
  ] as SocialMedia[])("rejects unsupported channel media metadata %j", (item) => {
    const publish = job();
    publish.payload.media = [item];
    expect(telegramChannelContentIssue(account(), publish)).toBeTruthy();
  });
  it("does not reveal token-bearing provider errors", async () => {
    const fetcher = vi.fn(async () =>
      Response.json(
        { ok: false, error_code: 403, description: "sensitive-token" },
        { status: 403 },
      ),
    );
    const adapter = createTelegramChannelAdapter(new SocialHttp(fetcher));
    await expect(
      adapter.send(account(), job(), "123:synthetic", async () => png),
    ).rejects.toMatchObject({ code: "denied" });
    await expect(
      adapter.send(account(), job(), "123:synthetic", async () => png),
    ).rejects.not.toThrow("sensitive-token");
  });
  it.each([
    [401, "expired"],
    [403, "denied"],
    [429, "rate_limit"],
    [503, "unknown"],
  ] as const)(
    "classifies dispatch HTTP %s without retry or secret exposure",
    async (status, code) => {
      const f = fixture();
      const successful = f.fetcher.getMockImplementation()!;
      f.fetcher.mockImplementation(async (raw, init) =>
        String(raw).endsWith("/sendMessage")
          ? Response.json(
              {
                ok: false,
                error_code: status,
                description: "sensitive-token",
                parameters: { retry_after: 17 },
              },
              { status },
            )
          : successful(raw, init),
      );
      try {
        await f.adapter.send(account(), job(), "123:synthetic", async () => png);
        throw new Error("Expected dispatch failure");
      } catch (error) {
        expect(error).toMatchObject({ code });
        expect(String(error)).not.toContain("sensitive-token");
      }
      expect(f.methods().filter((method) => method === "sendMessage")).toHaveLength(1);
    },
  );
  it("rejects channel payloads that try to address a DM or another post", () => {
    for (const key of ["recipientId", "threadId", "postId"] as const) {
      const publish = job();
      publish.payload[key] = "other-target";
      expect(telegramChannelContentIssue(account(), publish)).toContain("publishing only");
    }
    const empty = job();
    empty.payload.text = "";
    expect(telegramChannelContentIssue(account(), empty)).toContain("Enter message text");
    empty.payload.media = [
      { kind: "image", uploadId: "one" },
      { kind: "image", uploadId: "two" },
    ];
    expect(telegramChannelContentIssue(account(), empty)).toContain("one uploaded");
  });
});
