import { describe, expect, it, vi } from "vitest";
import { SocialHttp, SocialPlatformError, retryAfter } from "./adapter";
import { contentSupport, createSocialAdapters } from "./platformAdapters";
import { accountCapabilities, platformRequirements } from "./capabilities";
import type { SocialAccount, SocialJob } from "../../features/social/model/social";
const account = (platform: SocialAccount["platform"]): SocialAccount => ({
  id: "account",
  platform,
  platformId: platform === "linkedin" ? "urn:li:organization:123" : "123",
  name: "Account",
  accountType: platform === "linkedin" ? "organization" : "member",
  scopes: [],
  accessApproved: true,
  connected: true,
  paused: false,
  executorId: "host",
  grants: {},
  createdAt: 1,
});
const job = (kind: SocialJob["kind"] = "publish"): SocialJob => ({
  id: "job",
  operationId: "op",
  dedupeKey: "key",
  accountId: "account",
  projectIds: ["project"],
  provider: "owner",
  actorId: "device",
  kind,
  payload: { text: "Public text", media: [] },
  status: "running",
  scheduledAt: 1,
  attempts: 1,
  createdAt: 1,
});
describe("Resmi sosyal API adaptör sözleşmeleri", () => {
  it("X API messages attach one uploaded image using the DM media category", async () => {
    const fetcher = vi.fn(async (raw: string | URL | Request) =>
      Response.json(
        String(raw).includes("media/upload")
          ? { data: { id: "500" } }
          : { data: { dm_event_id: "600" } },
      ),
    );
    const adapter = createSocialAdapters(new SocialHttp(fetcher)).x;
    const message = job("message");
    message.payload.recipientId = "123";
    message.payload.media = [{ kind: "image", uploadId: "local" }];
    await adapter.send(
      account("x"),
      message,
      "synthetic",
      async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    const upload = fetcher.mock.calls[0][1]?.body as FormData;
    expect(upload.get("media_category")).toBe("dm_image");
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toMatchObject({
      attachments: [{ media_id: "500" }],
    });
  });
  it("X API never creates a post while the uploaded video is processing", async () => {
    const fetcher = vi.fn(async (raw: string | URL | Request) => {
      const path = String(raw);
      if (path.endsWith("initialize"))
        return Response.json({ data: { id: "500", expires_after_secs: 3600 } });
      if (path.endsWith("append")) return new Response(null, { status: 204 });
      return Response.json({
        data: { processing_info: { state: "pending", check_after_secs: 5 } },
      });
    });
    const publish = job();
    publish.payload.media = [{ kind: "video", uploadId: "local" }];
    await expect(
      createSocialAdapters(new SocialHttp(fetcher)).x.send(
        account("x"),
        publish,
        "synthetic",
        async () => new Uint8Array([0, 0, 0, 12, 102, 116, 121, 112, 105, 115, 111, 109]),
      ),
    ).rejects.toMatchObject({ code: "processing" });
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("/tweets"))).toBe(false);
  });
  it.each(["x", "instagram", "facebook"] as const)(
    "%s polling works with either authorized read channel and stays pending with no read scope",
    (platform) => {
      const a = account(platform);
      const requirements = platformRequirements(platform, a.accountType);
      for (const operation of ["inbox.read", "comments.read"] as const) {
        a.scopes = requirements[operation].scopes;
        expect(accountCapabilities(a).find((c) => c.operation === "poll")?.status).toBe(
          "available",
        );
      }
      a.scopes = [];
      expect(accountCapabilities(a).find((c) => c.operation === "poll")?.status).toBe("pending");
    },
  );
  it("Facebook message-only polling does not call comment discovery requiring extra permissions", async () => {
    const fetcher = vi.fn(async (_url: unknown) => Response.json({ data: [] }));
    const a = account("facebook");
    a.scopes = ["pages_messaging"];
    await createSocialAdapters(new SocialHttp(fetcher)).facebook.poll(a, "secret", []);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toContain("/conversations?");
  });
  it("Meta yorum ve mesaj sayfalarını kalıcı cursor ile okur; next URL içindeki token'ı kullanmaz", async () => {
    const fetcher = vi.fn(async (raw: string | URL | Request) => {
      const url = new URL(String(raw));
      if (url.pathname.endsWith("published_posts"))
        return Response.json({ data: [{ id: "post" }] });
      if (url.pathname.endsWith("/comments"))
        return Response.json({
          data: [
            {
              id: url.searchParams.has("after") ? "second-comment" : "first-comment",
              from: { id: "person" },
              message: "hello",
              created_time: "2026-10-10T09:00:00Z",
            },
          ],
          ...(url.searchParams.has("after")
            ? {}
            : {
                paging: {
                  next: "https://evil.test/?access_token=synthetic-secret",
                  cursors: { after: "comment-page-2" },
                },
              }),
        });
      if (url.pathname.endsWith("/messages"))
        return Response.json({
          data: [
            {
              id: "older-message",
              from: { id: "person" },
              message: "older",
              created_time: "2026-10-10T08:00:00Z",
            },
          ],
        });
      return Response.json({
        data: [
          {
            id: "conversation",
            messages: {
              data: [
                {
                  id: "new-message",
                  from: { id: "person" },
                  message: "new",
                  created_time: "2026-10-10T09:00:00Z",
                },
              ],
              paging: {
                next: "https://evil.test/?access_token=synthetic-secret",
                cursors: { after: "message-page-2" },
              },
            },
          },
        ],
      });
    });
    const acct = account("facebook");
    acct.scopes = ["pages_read_engagement", "pages_read_user_content", "pages_messaging"];
    const adapter = createSocialAdapters(new SocialHttp(fetcher)).facebook;
    const first = await adapter.poll(acct, "synthetic-token", []);
    expect(first.cursor).not.toContain("synthetic-secret");
    const second = await adapter.poll(acct, "synthetic-token", [], first.cursor);
    expect(second.events.map((event) => event.eventId)).toContain("second-comment");
    expect(second.events.map((event) => event.eventId)).toContain("older-message");
    const urls = fetcher.mock.calls.map((call) => new URL(String(call[0])));
    expect(
      urls.every(
        (url) => url.hostname === "graph.facebook.com" && !url.searchParams.has("access_token"),
      ),
    ).toBe(true);
    expect(urls.find((url) => url.pathname.endsWith("/messages"))?.searchParams.get("after")).toBe(
      "message-page-2",
    );
  });
  it("LinkedIn yorum taraması 100 olaydan sonra start alanını saklar", async () => {
    const fetcher = vi.fn(async (raw: string | URL | Request) => {
      const start = Number(new URL(String(raw)).searchParams.get("start"));
      return Response.json({
        elements: Array.from({ length: start ? 1 : 100 }, (_, i) => ({
          commentUrn: `urn:li:comment:${start + i}`,
          actor: "urn:li:person:123",
          object: "urn:li:share:123",
          message: { text: "hello" },
          created: { time: 1 },
        })),
        paging: { total: 101 },
      });
    });
    const acct = account("linkedin");
    const adapter = createSocialAdapters(new SocialHttp(fetcher)).linkedin;
    const first = await adapter.poll(acct, "synthetic-token", ["urn:li:share:123"]);
    const second = await adapter.poll(acct, "synthetic-token", [], first.cursor);
    expect(new URL(String(fetcher.mock.calls[1][0])).searchParams.get("start")).toBe("100");
    expect(second.events[0].eventId).toBe("urn:li:comment:100");
    expect(JSON.parse(second.cursor!).starts).toEqual({});
  });
  it("Meta HTTP 400 içindeki token, izin ve limit kodları sırları yansıtmadan ayrılır", async () => {
    for (const [code, expected] of [
      [190, "expired"],
      [200, "denied"],
      [4, "rate_limit"],
      [2, "unknown"],
    ] as const) {
      const http = new SocialHttp(
        vi.fn(async () =>
          Response.json({ error: { code, message: "synthetic-secret" } }, { status: 400 }),
        ),
        () => 1000,
      );
      await expect(
        http.request("https://graph.facebook.com/v25.0/me", "synthetic-token"),
      ).rejects.toMatchObject({ code: expected });
    }
    const page = account("facebook");
    page.connected = true;
    page.accessApproved = true;
    page.scopes = ["pages_manage_metadata"];
    expect(
      accountCapabilities(page).find((capability) => capability.operation === "webhook"),
    ).toMatchObject({ status: "pending" });
    expect(
      accountCapabilities(account("x")).find((capability) => capability.operation === "search"),
    ).toMatchObject({ status: "unsupported" });
  });
  it("X çok sayfalı gelen kutusu cursor'ı eski sayfalar bitmeden ilerlemez", async () => {
    const fetcher = vi.fn(async (raw: string | URL | Request) => {
      const url = new URL(String(raw));
      const second = url.searchParams.has("pagination_token");
      return Response.json({
        data: [
          {
            id: second ? "11" : "22",
            author_id: "person",
            text: "hello",
            created_at: "2026-10-10T09:00:00Z",
          },
        ],
        meta: second ? { newest_id: "11" } : { newest_id: "22", next_token: "next-page" },
      });
    });
    const acct = account("x");
    acct.scopes = ["tweet.read"];
    const adapter = createSocialAdapters(new SocialHttp(fetcher)).x;
    const first = await adapter.poll(acct, "synthetic-token", [], "10");
    expect(JSON.parse(first.cursor!).mentions).toEqual({
      since: "10",
      newest: "22",
      next: "next-page",
    });
    const second = await adapter.poll(acct, "synthetic-token", [], first.cursor);
    expect(second.events[0].eventId).toBe("11");
    expect(JSON.parse(second.cursor!).mentions).toEqual({ since: "22" });
    expect(new URL(String(fetcher.mock.calls[1][0])).searchParams.get("since_id")).toBe("10");
    expect(new URL(String(fetcher.mock.calls[1][0])).searchParams.get("pagination_token")).toBe(
      "next-page",
    );
  });
  it("LinkedIn kuruluş görseli hazırlanırken yükleme checkpoint'i korunur ve kötü upload URL reddedilir", async () => {
    let ready = false;
    const fetcher = vi.fn(async (raw: string | URL | Request) => {
      const url = String(raw);
      if (url.includes("initializeUpload"))
        return Response.json({
          value: {
            image: "urn:li:image:123",
            uploadUrl: "https://www.linkedin.com/dms-uploads/123",
          },
        });
      if (url.includes("dms-uploads")) return new Response(null, { status: 201 });
      if (url.includes("/rest/images/"))
        return Response.json({ status: ready ? "AVAILABLE" : "PROCESSING" });
      return new Response(null, {
        status: 201,
        headers: { "x-restli-id": "urn:li:share:123" },
      });
    });
    const acct = account("linkedin");
    acct.accountType = "organization";
    acct.platformId = "urn:li:organization:123";
    const publish = job();
    publish.payload.media = [{ kind: "image", uploadId: "local" }];
    const adapter = createSocialAdapters(new SocialHttp(fetcher)).linkedin;
    const save = (state: NonNullable<SocialJob["preparation"]>) => {
      publish.preparation = state;
    };
    await expect(
      adapter.send(acct, publish, "synthetic-token", async () => new Uint8Array([137, 80]), save),
    ).rejects.toMatchObject({ code: "rate_limit" });
    ready = true;
    expect(
      await adapter.send(
        acct,
        publish,
        "synthetic-token",
        async () => {
          throw new Error("Already uploaded");
        },
        save,
      ),
    ).toMatchObject({ platformId: "urn:li:share:123" });
    expect(
      fetcher.mock.calls.filter((call) => String(call[0]).includes("dms-uploads")),
    ).toHaveLength(1);
    const evil = vi.fn();
    await expect(
      new SocialHttp(evil).uploadLinkedInImage(
        "https://evil.test/dms-uploads/123",
        "synthetic-token",
        new Uint8Array(),
      ),
    ).rejects.toMatchObject({ code: "denied" });
    expect(evil).not.toHaveBeenCalled();
  });
  it("X yeni DM ve mevcut konuşma farklı resmi endpoint kullanır", async () => {
    const fetcher = vi.fn(async () => Response.json({ data: { dm_event_id: "456" } }));
    const adapters = createSocialAdapters(new SocialHttp(fetcher));
    const message = job("message");
    message.payload.recipientId = "person";
    await adapters.x.send(account("x"), message, "synthetic-token", async () => new Uint8Array());
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://api.x.com/2/dm_conversations/with/person/messages",
    );
    message.payload.threadId = "conversation";
    await adapters.x.send(account("x"), message, "synthetic-token", async () => new Uint8Array());
    expect(fetcher.mock.calls[1][0]).toContain("dm_conversations/conversation/messages");
  });
  it("X görsel MIME doğru gider ve başarılı yükleme checkpoint'i sonraki denemede tekrar yüklenmez", async () => {
    const fetcher = vi.fn(async (raw: string | URL | Request) =>
      Response.json(
        String(raw).includes("media/upload")
          ? { data: { id: "12345" } }
          : { data: { id: "post123" } },
      ),
    );
    const adapters = createSocialAdapters(new SocialHttp(fetcher));
    const publish = job();
    publish.payload.media = [{ kind: "image", uploadId: "local" }];
    const save = vi.fn((state) => {
      publish.preparation = state;
    });
    await adapters.x.send(
      account("x"),
      publish,
      "synthetic-token",
      async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      save,
    );
    const body = fetcher.mock.calls[0][1]?.body as FormData;
    expect((body.get("media") as Blob).type).toBe("image/png");
    expect(save).toHaveBeenCalledWith({ mediaIds: ["12345"] });
    await adapters.x.send(
      account("x"),
      publish,
      "synthetic-token",
      async () => {
        throw new Error("Already uploaded");
      },
      save,
    );
    expect(
      fetcher.mock.calls.filter((call) => String(call[0]).includes("media/upload")),
    ).toHaveLength(1);
  });
  it("Instagram hazırlık sürerken aynı kapsayıcı saklanır; hazır olunca tek publish yapılır", async () => {
    let ready = false;
    const fetcher = vi.fn(async (raw: string | URL | Request) => {
      const path = new URL(String(raw)).pathname;
      if (path.endsWith("/media")) return Response.json({ id: "container" });
      if (path.endsWith("/media_publish")) return Response.json({ id: "published" });
      if (path.endsWith("/published"))
        return Response.json({
          permalink: "https://www.instagram.com/p/published/",
        });
      return Response.json({ status_code: ready ? "FINISHED" : "IN_PROGRESS" });
    });
    const adapters = createSocialAdapters(new SocialHttp(fetcher));
    const publish = job();
    publish.payload.media = [{ kind: "image", url: "https://cdn.test/image.jpg" }];
    const save = (state: NonNullable<SocialJob["preparation"]>) => {
      publish.preparation = state;
    };
    await expect(
      adapters.instagram.send(
        account("instagram"),
        publish,
        "synthetic-token",
        async () => new Uint8Array(),
        save,
      ),
    ).rejects.toMatchObject({ code: "rate_limit" });
    ready = true;
    expect(
      await adapters.instagram.send(
        account("instagram"),
        publish,
        "synthetic-token",
        async () => new Uint8Array(),
        save,
      ),
    ).toMatchObject({ platformId: "published" });
    expect(
      fetcher.mock.calls.filter((call) => new URL(String(call[0])).pathname.endsWith("/media")),
    ).toHaveLength(1);
    expect(
      fetcher.mock.calls.filter((call) =>
        new URL(String(call[0])).pathname.endsWith("/media_publish"),
      ),
    ).toHaveLength(1);
  });
  it("LinkedIn yorum yanıtı doğru composite URN ve parentComment alanını taşır", async () => {
    const fetcher = vi.fn(async () => Response.json({ id: "reply" }));
    const adapters = createSocialAdapters(new SocialHttp(fetcher));
    const reply = job("reply");
    reply.payload.postId = "urn:li:comment:(urn:li:activity:123,456)";
    reply.payload.objectPostId = "urn:li:activity:123";
    await adapters.linkedin.send(
      account("linkedin"),
      reply,
      "synthetic-token",
      async () => new Uint8Array(),
    );
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
      object: "urn:li:activity:123",
      parentComment: reply.payload.postId,
    });
    await expect(
      adapters.linkedin.send(
        account("linkedin"),
        job("message"),
        "synthetic-token",
        async () => new Uint8Array(),
      ),
    ).rejects.toMatchObject({ code: "unsupported" });
  });
  it("HTTP hata gövdeleri token içerdiğinde bile araç hatası sırları yansıtmaz", async () => {
    for (const [status, code] of [
      [401, "expired"],
      [403, "denied"],
      [429, "rate_limit"],
      [503, "unknown"],
    ] as const) {
      const http = new SocialHttp(
        vi.fn(async () =>
          Response.json(
            { error: "synthetic-secret-token" },
            { status, headers: { "Retry-After": "17" } },
          ),
        ),
        () => 1000,
      );
      try {
        await http.request("https://api.x.com/2/tweets", "synthetic-token");
        throw new Error("Expected failure");
      } catch (error) {
        expect(error).toBeInstanceOf(SocialPlatformError);
        expect(error).toMatchObject({ code });
        expect(String(error)).not.toContain("synthetic");
        if (code === "rate_limit") expect(error).toMatchObject({ retryAt: 18000 });
      }
    }
    const fetcher = vi.fn();
    await expect(
      new SocialHttp(fetcher).request("https://evil.test/2/tweets", "synthetic-token"),
    ).rejects.toMatchObject({ code: "denied" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(retryAfter(new Headers({ "Retry-After": "Thu, 01 Jan 1970 00:01:00 GMT" }), 1000)).toBe(
      60000,
    );
  });
  it("uygulanmamış video ve yanlış medya şekli önizlemede gerekçesiyle reddedilir", () => {
    const publish = job();
    publish.payload.media = [{ kind: "video", url: "https://cdn.test/video.mp4" }];
    expect(contentSupport(account("x"), publish)).toContain("host-uploaded");
    publish.payload.media = [{ kind: "video", uploadId: "local" }];
    expect(contentSupport(account("x"), publish)).toBeUndefined();
    publish.payload.media = [];
    expect(contentSupport(account("instagram"), publish)).toContain("exactly one");
  });
});
