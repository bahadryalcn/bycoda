import { describe, expect, it, vi } from "vitest";
import { SocialHttp, SocialPlatformError } from "./adapter";
import { createSocialAdapters } from "./platformAdapters";
import { accountCapabilities } from "./capabilities";
import type { SocialAccount, SocialJob } from "../../features/social/model/social";
import { messagingContentIssue } from "./messaging";

const account = (platform: SocialAccount["platform"]): SocialAccount => ({
  id: "account",
  platform,
  platformId: "123456",
  name: "Account",
  accountType: platform === "telegram" ? "bot" : "business",
  scopes: ["bot.send", "bot.poll", "whatsapp_business_messaging", "bycoda.webhook"],
  accessApproved: true,
  connected: true,
  paused: false,
  executorId: "host",
  grants: {},
  createdAt: 1,
});
const job = (): SocialJob => ({
  id: "job",
  operationId: "op",
  dedupeKey: "key",
  accountId: "account",
  projectIds: ["project"],
  provider: "owner",
  actorId: "owner",
  kind: "reply",
  payload: { text: "Reply", media: [], recipientId: "1234567890", threadId: "-123456" },
  status: "running",
  scheduledAt: 1,
  attempts: 1,
  createdAt: 1,
});

describe("Messaging adapters", () => {
  it.each(["telegram", "whatsapp"] as const)(
    "%s rechecks current send permission before transmitting a valid reply",
    async (platform) => {
      const fetcher = vi.fn();
      const guard = vi.fn(async () => {
        throw new SocialPlatformError("denied");
      });
      await expect(
        createSocialAdapters(new SocialHttp(fetcher))[platform].send(
          account(platform),
          job(),
          "synthetic",
          async () => new Uint8Array(),
          undefined,
          guard,
        ),
      ).rejects.toMatchObject({ code: "denied" });
      expect(guard).toHaveBeenCalledOnce();
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it("Telegram persists the high-water offset, ignores non-message updates and separates identical message IDs in different chats", async () => {
    const fetcher = vi.fn(async (_url: unknown, _options?: RequestInit) =>
      Response.json({
        ok: true,
        result: [
          {
            update_id: 10,
            message: {
              message_id: 2,
              date: 100,
              text: "One",
              chat: { id: 123, first_name: "One" },
            },
          },
          {
            update_id: 11,
            message: { message_id: 2, date: 100, text: "Two", chat: { id: -456, title: "Group" } },
          },
          { update_id: 12, edited_message: {} },
        ],
      }),
    );
    const adapter = createSocialAdapters(new SocialHttp(fetcher)).telegram;
    const result = await adapter.poll(account("telegram"), "123:test_token", [], "10");
    expect(result.cursor).toBe("13");
    expect(result.events.map((event) => [event.eventId, event.threadId])).toEqual([
      ["123:2", "123"],
      ["-456:2", "-456"],
    ]);
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toMatchObject({
      offset: 10,
      allowed_updates: ["message"],
    });
  });
  it("Telegram replies to the original group chat without parse-mode injection", async () => {
    const fetcher = vi.fn(async (_url: unknown, _options?: RequestInit) =>
      Response.json({ ok: true, result: { message_id: 3, chat: { id: -123456 } } }),
    );
    const adapter = createSocialAdapters(new SocialHttp(fetcher)).telegram;
    expect(
      await adapter.send(
        account("telegram"),
        job(),
        "123:test_token",
        async () => new Uint8Array(),
      ),
    ).toEqual({ platformId: "-123456:3" });
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({
      chat_id: "-123456",
      text: "Reply",
    });
    const unsupported = job();
    unsupported.kind = "publish";
    await expect(
      adapter.send(
        account("telegram"),
        unsupported,
        "123:test_token",
        async () => new Uint8Array(),
      ),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("Telegram sanitizes token-bearing fetch errors and honors JSON retry_after", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("https://api.telegram.org/bot123:secret/getMe");
    });
    await expect(new SocialHttp(fetcher).telegram("getMe", "123:secret")).rejects.toMatchObject({
      code: "unknown",
      message: "Platform outcome is uncertain. Review before another send.",
    });
    const limited = new SocialHttp(
      async () => Response.json({ ok: false, error_code: 429, parameters: { retry_after: 90 } }),
      () => 1000,
    );
    await expect(limited.telegram("sendMessage", "123:secret")).rejects.toMatchObject({
      code: "rate_limit",
      retryAt: 91000,
    });
  });
  it("WhatsApp sends text replies and rejects initiation before network I/O", async () => {
    const fetcher = vi.fn(async (_url: unknown, _options?: RequestInit) =>
      Response.json({ messages: [{ id: "wamid.example" }] }),
    );
    const adapter = createSocialAdapters(new SocialHttp(fetcher)).whatsapp;
    expect(
      await adapter.send(account("whatsapp"), job(), "secret", async () => new Uint8Array()),
    ).toEqual({ platformId: "wamid.example" });
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toMatchObject({
      messaging_product: "whatsapp",
      to: "1234567890",
      text: { body: "Reply" },
    });
    const outreach = job();
    outreach.kind = "message";
    await expect(
      adapter.send(account("whatsapp"), outreach, "secret", async () => new Uint8Array()),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["snapchat"] as const)(
    "%s never advertises unimplemented sends as available",
    (platform) => {
      expect(
        accountCapabilities(account(platform)).every(
          (capability) => capability.status === "unsupported",
        ),
      ).toBe(true);
    },
  );
  it("WhatsApp messaging stays pending until the signed receiver is configured", () => {
    const a = account("whatsapp");
    a.scopes = ["whatsapp_business_messaging"];
    expect(
      accountCapabilities(a).find((capability) => capability.operation === "message.reply")?.status,
    ).toBe("pending");
  });
});

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const mp4 = new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109]);
const mediaJob = (kind: "image" | "video" = "image") => {
  const value = job();
  value.payload.media = [{ kind, uploadId: "reviewed-upload" }];
  return value;
};

describe("Messaging API attachments", () => {
  it.each(["image", "video"] as const)(
    "sends a Telegram %s as one multipart operation with its reviewed caption",
    async (kind) => {
      const fetcher = vi.fn(async (_url: unknown, _options?: RequestInit) =>
        Response.json({
          ok: true,
          result: {
            message_id: 8,
            chat: { id: -123456 },
            ...(kind === "image"
              ? { photo: [{ file_id: "persisted-photo" }] }
              : { video: { file_id: "persisted-video" } }),
          },
        }),
      );
      const send = mediaJob(kind);
      send.payload.text = "<b>reviewed, literal caption</b>";
      send.payload.link = "https://bycoda.com";
      const guard = vi.fn(async () => undefined);
      expect(
        await createSocialAdapters(new SocialHttp(fetcher)).telegram.send(
          account("telegram"),
          send,
          "123:synthetic",
          async () => (kind === "image" ? png : mp4),
          undefined,
          guard,
        ),
      ).toEqual({ platformId: "-123456:8" });
      expect(fetcher).toHaveBeenCalledOnce();
      const [url, options] = fetcher.mock.calls[0]!;
      expect(url).toBe(
        `https://api.telegram.org/bot123:synthetic/${kind === "image" ? "sendPhoto" : "sendVideo"}`,
      );
      expect(options?.headers).toBeUndefined();
      const form = options?.body as FormData;
      expect(form.get("chat_id")).toBe("-123456");
      expect(form.get("caption")).toBe("<b>reviewed, literal caption</b>\nhttps://bycoda.com");
      expect(form.has("parse_mode")).toBe(false);
      const file = form.get(kind === "image" ? "photo" : "video") as File;
      expect(file.type).toBe(kind === "image" ? "image/png" : "video/mp4");
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(kind === "image" ? png : mp4);
      expect(guard).toHaveBeenCalledOnce();
      expect(guard.mock.invocationCallOrder[0]).toBeLessThan(fetcher.mock.invocationCallOrder[0]!);
    },
  );

  it("permits an attachment-only Telegram message and binds its acknowledgement to the requested chat", async () => {
    const fetcher = vi.fn(async (_url: unknown, _options?: RequestInit) =>
      Response.json({
        ok: true,
        result: {
          message_id: 4,
          chat: { id: 999 },
          photo: [{ file_id: "photo" }],
        },
      }),
    );
    const send = mediaJob();
    send.payload.text = "";
    await expect(
      createSocialAdapters(new SocialHttp(fetcher)).telegram.send(
        account("telegram"),
        send,
        "123:synthetic",
        async () => png,
      ),
    ).rejects.toMatchObject({ code: "unknown" });
    const form = fetcher.mock.calls[0]![1]!.body as FormData;
    expect(form.has("caption")).toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    { message_id: 0, chat: { id: -123456 }, photo: [{ file_id: "photo" }] },
    { message_id: 8, chat: { id: -123456 } },
    { message_id: 8, chat: { id: -123456 }, photo: [] },
  ])("holds incomplete Telegram media acknowledgement as unknown", async (result) => {
    const fetcher = vi.fn(async () => Response.json({ ok: true, result }));
    await expect(
      createSocialAdapters(new SocialHttp(fetcher)).telegram.send(
        account("telegram"),
        mediaJob(),
        "123:synthetic",
        async () => png,
      ),
    ).rejects.toMatchObject({ code: "unknown" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rechecks Telegram permission after reading the attachment without submitting on denial", async () => {
    const fetcher = vi.fn();
    let prepared = false;
    const guard = vi.fn(async () => {
      expect(prepared).toBe(true);
      throw new SocialPlatformError("denied");
    });
    await expect(
      createSocialAdapters(new SocialHttp(fetcher)).telegram.send(
        account("telegram"),
        mediaJob(),
        "123:synthetic",
        async () => {
          prepared = true;
          return png;
        },
        undefined,
        guard,
      ),
    ).rejects.toMatchObject({ code: "denied" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("persists a WhatsApp upload before the final permission check and reuses it after a denied send", async () => {
    const order: string[] = [];
    const fetcher = vi.fn(async (url: unknown, _options?: RequestInit) => {
      order.push(String(url).endsWith("/media") ? "upload" : "send");
      return Response.json(
        String(url).endsWith("/media")
          ? { id: "998877" }
          : {
              contacts: [{ wa_id: "1234567890" }],
              messages: [{ id: "wamid.media" }],
            },
      );
    });
    const send = mediaJob();
    const read = vi.fn(async () => png);
    const checkpoint = vi.fn(async (state: NonNullable<SocialJob["preparation"]>) => {
      await Promise.resolve();
      expect(state.mediaIds).toEqual(["998877"]);
      order.push("checkpoint");
    });
    const denied = vi.fn(async () => {
      order.push("guard-denied");
      throw new SocialPlatformError("denied");
    });
    const adapter = createSocialAdapters(new SocialHttp(fetcher)).whatsapp;
    await expect(
      adapter.send(account("whatsapp"), send, "synthetic", read, checkpoint, denied),
    ).rejects.toMatchObject({ code: "denied" });
    expect(order).toEqual(["upload", "checkpoint", "guard-denied"]);
    expect(send.preparation?.mediaIds).toEqual(["998877"]);
    const guard = vi.fn(async () => {
      order.push("guard-approved");
    });
    expect(
      await adapter.send(account("whatsapp"), send, "synthetic", read, checkpoint, guard),
    ).toEqual({ platformId: "wamid.media" });
    expect(order).toEqual(["upload", "checkpoint", "guard-denied", "guard-approved", "send"]);
    expect(read).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(2);
    const form = fetcher.mock.calls[0]![1]?.body as FormData;
    expect(form.get("messaging_product")).toBe("whatsapp");
    expect(form.get("type")).toBe("image/png");
    expect((form.get("file") as File).type).toBe("image/png");
    expect(fetcher.mock.calls[0]![1]?.headers).toEqual({ Authorization: "Bearer synthetic" });
    expect(JSON.parse(fetcher.mock.calls[1]![1]?.body as string)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "1234567890",
      type: "image",
      image: { id: "998877", caption: "Reply" },
    });
  });

  it("sends a WhatsApp attachment-only MP4 reply without an extra text message", async () => {
    const fetcher = vi.fn(async (url: unknown, _options?: RequestInit) =>
      Response.json(
        String(url).endsWith("/media") ? { id: "998877" } : { messages: [{ id: "wamid.video" }] },
      ),
    );
    const send = mediaJob("video");
    send.payload.text = "";
    expect(
      await createSocialAdapters(new SocialHttp(fetcher)).whatsapp.send(
        account("whatsapp"),
        send,
        "synthetic",
        async () => mp4,
      ),
    ).toEqual({ platformId: "wamid.video" });
    expect(JSON.parse(fetcher.mock.calls[1]![1]?.body as string)).toMatchObject({
      type: "video",
      video: { id: "998877" },
    });
    expect(JSON.parse(fetcher.mock.calls[1]![1]?.body as string).video).not.toHaveProperty(
      "caption",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not submit WhatsApp media when upload persistence fails", async () => {
    const fetcher = vi.fn(async () => Response.json({ id: "998877" }));
    const guard = vi.fn();
    await expect(
      createSocialAdapters(new SocialHttp(fetcher)).whatsapp.send(
        account("whatsapp"),
        mediaJob(),
        "synthetic",
        async () => png,
        async () => {
          throw new Error("checkpoint unavailable");
        },
        guard,
      ),
    ).rejects.toThrow("checkpoint unavailable");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(guard).not.toHaveBeenCalled();
  });

  it("holds a WhatsApp media send with a mismatched recipient acknowledgement without retrying", async () => {
    const fetcher = vi.fn(async (url: unknown) =>
      Response.json(
        String(url).endsWith("/media")
          ? { id: "998877" }
          : {
              contacts: [{ wa_id: "9999999999" }],
              messages: [{ id: "wamid.other-recipient" }],
            },
      ),
    );
    await expect(
      createSocialAdapters(new SocialHttp(fetcher)).whatsapp.send(
        account("whatsapp"),
        mediaJob(),
        "synthetic",
        async () => png,
      ),
    ).rejects.toMatchObject({ code: "unknown" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not submit WhatsApp media when upload acknowledgement has no media ID", async () => {
    const fetcher = vi.fn(async () => Response.json({ success: true }));
    const guard = vi.fn();
    await expect(
      createSocialAdapters(new SocialHttp(fetcher)).whatsapp.send(
        account("whatsapp"),
        mediaJob(),
        "synthetic",
        async () => png,
        undefined,
        guard,
      ),
    ).rejects.toMatchObject({ code: "unknown" });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(guard).not.toHaveBeenCalled();
  });

  it.each([{ ids: [] }, { ids: ["invalid"] }, { ids: ["998877", "998878"] }])(
    "rejects malformed persisted WhatsApp media IDs before external I/O",
    async ({ ids }) => {
      const fetcher = vi.fn();
      const send = mediaJob();
      send.preparation = { mediaIds: ids };
      await expect(
        createSocialAdapters(new SocialHttp(fetcher)).whatsapp.send(
          account("whatsapp"),
          send,
          "synthetic",
          async () => png,
        ),
      ).rejects.toMatchObject({ code: "rejected" });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each(["telegram", "whatsapp"] as const)(
    "%s rejects caption overflow, URLs, multiple media, documents and wrong bytes before send",
    async (platform) => {
      const fetcher = vi.fn();
      const adapter = createSocialAdapters(new SocialHttp(fetcher))[platform];
      const invalid = [mediaJob(), mediaJob(), mediaJob(), mediaJob(), mediaJob()];
      invalid[0]!.payload.text = "a".repeat(1025);
      invalid[1]!.payload.media[0]!.url = "https://example.com/p.png";
      invalid[2]!.payload.media.push({ kind: "image", uploadId: "second" });
      invalid[3]!.payload.media[0]!.kind = "document";
      invalid[4]!.payload.media[0]!.alt = "Description cannot silently disappear";
      for (const send of invalid)
        await expect(
          adapter.send(account(platform), send, "123:synthetic", async () => png),
        ).rejects.toMatchObject({ code: "unsupported" });
      await expect(
        adapter.send(account(platform), mediaJob("video"), "123:synthetic", async () => png),
      ).rejects.toMatchObject({ code: "rejected" });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each(["telegram", "whatsapp"] as const)("%s validates video byte limits", async (platform) => {
    const bytes = new Uint8Array((platform === "telegram" ? 50 : 16) * 1024 * 1024 + 1);
    bytes.set(mp4);
    const fetcher = vi.fn();
    await expect(
      createSocialAdapters(new SocialHttp(fetcher))[platform].send(
        account(platform),
        mediaJob("video"),
        "123:synthetic",
        async () => bytes,
      ),
    ).rejects.toMatchObject({ code: "rejected" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("counts links in captions and retains the WhatsApp initiation boundary", () => {
    const send = mediaJob();
    send.payload.text = "a".repeat(1024);
    expect(messagingContentIssue(account("telegram"), send)).toBeUndefined();
    send.payload.link = "https://bycoda.com";
    expect(messagingContentIssue(account("telegram"), send)).toContain("1024");
    send.payload.link = undefined;
    send.kind = "message";
    expect(messagingContentIssue(account("whatsapp"), send)).toContain("customer replies");
  });
});
