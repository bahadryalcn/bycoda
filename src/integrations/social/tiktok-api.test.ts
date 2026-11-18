import { describe, expect, it, vi } from "vitest";
import type {
  SocialAccount,
  SocialJob,
  TikTokVideoOptions,
} from "../../features/social/model/social";
import { SocialHttp } from "./adapter";
import {
  TIKTOK_PROCESSING_DEADLINE_MS,
  createTikTokAdapter,
  parseTikTokOptions,
  tiktokContentIssue,
  tiktokMode,
} from "./tiktok";

/** API-level TikTok tests: inbox drafts, processing deadline, HTTP mapping and Display API. Mocked network only. */
const account: SocialAccount = {
  id: "a",
  platform: "tiktok",
  platformId: "creator",
  name: "Owner",
  accountType: "member",
  scopes: ["user.info.basic", "video.publish"],
  accessApproved: true,
  connected: true,
  paused: false,
  executorId: "host",
  grants: {},
  createdAt: 1,
};
const options: TikTokVideoOptions = {
  privacy: "SELF_ONLY",
  durationSeconds: 30,
  allowComment: false,
  allowDuet: false,
  allowStitch: false,
  brandContent: false,
  brandOrganic: false,
  isAigc: true,
  consent: true,
};
const creator = {
  creator_nickname: "Owner",
  privacy_level_options: ["SELF_ONLY"],
  comment_disabled: true,
  duet_disabled: false,
  stitch_disabled: false,
  max_video_post_duration_sec: 60,
};
const job = (): SocialJob => ({
  id: "j",
  operationId: "o",
  dedupeKey: "d",
  accountId: "a",
  projectIds: ["p"],
  provider: "owner",
  actorId: "owner",
  kind: "publish",
  payload: {
    text: "Caption",
    media: [{ kind: "video", url: "https://verified.example/video.mp4" }],
    tiktok: { ...options },
  },
  status: "running",
  scheduledAt: 1,
  attempts: 1,
  createdAt: 1,
});
const response = (data: unknown) => Response.json({ data, error: { code: "ok" } });
const noBody = async () => new Uint8Array();
const inboxJobFor = (): SocialJob => ({
  ...job(),
  payload: {
    ...job().payload,
    tiktok: {
      ...options,
      privacy: "",
      consent: false,
      mode: "inbox",
    } as unknown as TikTokVideoOptions,
  },
});

describe("TikTok inbox drafts", () => {
  const inboxOptions = {
    ...options,
    privacy: "",
    consent: false,
    mode: "inbox",
  } as unknown as TikTokVideoOptions;
  const inboxJob = (): SocialJob => ({
    ...job(),
    payload: { ...job().payload, tiktok: inboxOptions },
  });
  it("parses the mode and skips visibility, consent and branding rules only for drafts", () => {
    expect(tiktokMode(parseTikTokOptions({ ...options, mode: "inbox", privacy: "" }))).toBe(
      "inbox",
    );
    expect(tiktokMode(parseTikTokOptions({ ...options }))).toBe("direct");
    expect(() => parseTikTokOptions({ ...options, mode: "scheduled" })).toThrow();
    expect(tiktokContentIssue(inboxJob())).toBeUndefined();
    const directWithoutVisibility = inboxJob();
    directWithoutVisibility.payload.tiktok = {
      ...inboxOptions,
      mode: undefined,
    } as unknown as TikTokVideoOptions;
    expect(tiktokContentIssue(directWithoutVisibility)).toBeTruthy();
  });
  it("uploads a draft without post_info and only with the video.upload permission", async () => {
    const fetcher = vi.fn(async (raw: unknown, _options?: RequestInit) => {
      const path = new URL(String(raw)).pathname;
      if (path.includes("user/info")) return response({ user: { open_id: "creator" } });
      if (path.includes("video/init")) return response({ publish_id: "v_pub~123" });
      if (path.includes("status/fetch")) return response({ status: "PUBLISH_COMPLETE" });
      throw new Error("Unexpected network target");
    });
    const adapter = createTikTokAdapter(new SocialHttp(fetcher), () => 1000);
    await expect(adapter.send(account, inboxJob(), "secret", noBody)).rejects.toMatchObject({
      code: "denied",
    });
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("/init/"))).toBe(false);
    const granted = { ...account, scopes: [...account.scopes, "video.upload"] };
    const done = await adapter.send(granted, inboxJob(), "secret", noBody);
    expect(done).toEqual({ platformId: "v_pub~123" });
    const init = fetcher.mock.calls.find(([url]) => String(url).includes("video/init"))!;
    expect(new URL(String(init[0])).pathname).toBe("/v2/post/publish/inbox/video/init/");
    expect(JSON.parse(init[1]!.body as string)).toEqual({
      source_info: { source: "PULL_FROM_URL", video_url: "https://verified.example/video.mp4" },
    });
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("creator_info"))).toBe(false);
  });
  it("completes a draft when TikTok reports it delivered to the inbox, without a public ID", async () => {
    const fetcher = vi.fn(async (raw: unknown, _options?: RequestInit) =>
      String(raw).includes("status/fetch")
        ? response({ status: "SEND_TO_USER_INBOX", publicaly_available_post_id: [] })
        : response({}),
    );
    const adapter = createTikTokAdapter(new SocialHttp(fetcher), () => 1000);
    const draft: SocialJob = {
      ...inboxJobFor(),
      preparation: { tiktokPublishId: "v_pub~777" },
    };
    await expect(
      adapter.reconcile!(
        { ...account, scopes: [...account.scopes, "video.upload"] },
        draft,
        "secret",
      ),
    ).resolves.toEqual({ platformId: "v_pub~777", visibility: undefined });
    const direct: SocialJob = { ...job(), preparation: { tiktokPublishId: "v_pub~777" } };
    await expect(adapter.reconcile!(account, direct, "secret")).resolves.toBeUndefined();
  });
});

describe("TikTok file upload", () => {
  const signedUrl = "https://open-upload.tiktokapis.com/video/?upload_id=123&upload_token=secret";
  const publishId = "v_pub_file~123";
  const uploadId = "00000000-0000-4000-8000-000000000001";
  const request = (inbox: boolean) => {
    const value = inbox ? inboxJobFor() : job();
    value.payload.media = [{ kind: "video", uploadId }];
    return value;
  };
  const media = (size: number) => {
    const bytes = new Uint8Array(size);
    bytes.set([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
    return bytes;
  };
  const setup = (url = signedUrl, uploadStatus?: number) => {
    const sequence: string[] = [];
    const fetcher = vi.fn(async (raw: unknown, options?: RequestInit) => {
      const url = new URL(String(raw));
      if (url.pathname.endsWith("/user/info/")) return response({ user: { open_id: "creator" } });
      if (url.pathname.endsWith("/creator_info/query/")) return response(creator);
      if (url.pathname.endsWith("/init/")) {
        sequence.push("init");
        return response({ publish_id: publishId, upload_url: urlForUpload });
      }
      if (url.pathname.endsWith("/status/fetch/")) {
        sequence.push("status");
        return response({ status: "PUBLISH_COMPLETE" });
      }
      sequence.push("put");
      const range = new Headers(options?.headers).get("Content-Range")!;
      const final = /-(\d+)\/(\d+)$/.exec(range)!;
      return new Response(null, { status: uploadStatus ?? (Number(final[1]) + 1 === Number(final[2]) ? 201 : 206) });
    });
    const urlForUpload = url;
    const adapter = createTikTokAdapter(new SocialHttp(fetcher), () => 1000);
    const checkpoint = vi.fn(async () => { sequence.push("checkpoint"); });
    return { adapter, checkpoint, fetcher, sequence };
  };
  it.each([false, true])("uploads a Host-owned video with inbox mode %s", async (inbox) => {
    const { adapter, checkpoint, fetcher, sequence } = setup();
    const read = vi.fn(async () => media(24));
    const beforeSubmit = vi.fn(async () => { sequence.push("authorize"); });
    const granted = { ...account, scopes: [...account.scopes, "video.upload"] };
    const outgoing = request(inbox);
    expect(tiktokContentIssue(outgoing)).toBeUndefined();
    await expect(adapter.send(granted, outgoing, "oauth-secret", read, checkpoint, beforeSubmit)).resolves.toMatchObject({ platformId: publishId });
    expect(read).toHaveBeenCalledExactlyOnceWith(uploadId);
    expect(checkpoint).toHaveBeenCalledExactlyOnceWith({ tiktokPublishId: publishId });
    expect(sequence).toEqual(["authorize", "init", "checkpoint", "authorize", "put", "status"]);
    const [initUrl, init] = fetcher.mock.calls.find(([url]) => String(url).includes("/init/"))!;
    expect(new URL(String(initUrl)).pathname).toBe(`/v2/post/publish/${inbox ? "inbox/" : ""}video/init/`);
    expect(JSON.parse(init!.body as string).source_info).toEqual({
      source: "FILE_UPLOAD", video_size: 24, chunk_size: 24, total_chunk_count: 1,
    });
    const [url, put] = fetcher.mock.calls.find(([, input]) => input?.method === "PUT")!;
    expect(url).toBe(signedUrl);
    expect(put).toMatchObject({ method: "PUT", redirect: "error", headers: {
      "Content-Type": "video/mp4", "Content-Length": "24", "Content-Range": "bytes 0-23/24",
    } });
    expect(new Headers(put?.headers).has("Authorization")).toBe(false);
  });
  it("uploads sequentially and merges the short tail into the final chunk", async () => {
    const { adapter, fetcher, sequence } = setup();
    await adapter.send(account, request(false), "secret", async () => media(64_000_123));
    const transfers = fetcher.mock.calls.filter(([, init]) => init?.method === "PUT");
    expect(sequence).toEqual(["init", "put", "put", "put", "put", "put", "put", "status"]);
    expect(transfers.map(([, init]) => new Headers(init?.headers).get("Content-Range"))).toEqual([
      "bytes 0-9999999/64000123", "bytes 10000000-19999999/64000123",
      "bytes 20000000-29999999/64000123", "bytes 30000000-39999999/64000123",
      "bytes 40000000-49999999/64000123", "bytes 50000000-64000122/64000123",
    ]);
  });
  it.each([
    ["https://open-upload.tiktokapis.com.example/video/?upload_token=secret", undefined, 0],
    [signedUrl, 500, 1],
  ] as const)("stops on an invalid URL or uncertain transfer (%s)", async (url, status, puts) => {
    const { adapter, fetcher } = setup(url, status);
    const incoming = request(false);
    await expect(adapter.send(account, incoming, "oauth-secret", async () => media(24))).rejects.toMatchObject({ code: "unknown" });
    expect(incoming.preparation).toEqual({ tiktokPublishId: publishId });
    await adapter.send(account, incoming, "oauth-secret", async () => media(24));
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(puts);
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes("/init/"))).toHaveLength(1);
  });
});

describe("TikTok processing deadline", () => {
  it("keeps a processing publication pending until the deadline, then reports it uncertain", async () => {
    let clock = 1000;
    const fetcher = vi.fn(async (raw: unknown, _options?: RequestInit) => {
      const path = new URL(String(raw)).pathname;
      if (path.includes("user/info")) return response({ user: { open_id: "creator" } });
      if (path.includes("creator_info")) return response(creator);
      if (path.includes("video/init")) return response({ publish_id: "v_pub~123" });
      if (path.includes("status/fetch")) return response({ status: "PROCESSING_UPLOAD" });
      throw new Error("Unexpected network target");
    });
    const adapter = createTikTokAdapter(new SocialHttp(fetcher, () => clock), () => clock);
    const j: SocialJob = { ...job(), dispatchedAt: 1000 };
    await expect(adapter.send(account, j, "secret", noBody)).rejects.toMatchObject({
      code: "processing",
      retryAt: 31000,
    });
    clock = 1000 + TIKTOK_PROCESSING_DEADLINE_MS - 1;
    await expect(adapter.send(account, j, "secret", noBody)).rejects.toMatchObject({
      code: "processing",
    });
    clock = 1000 + TIKTOK_PROCESSING_DEADLINE_MS;
    await expect(adapter.send(account, j, "secret", noBody)).rejects.toMatchObject({
      code: "unknown",
    });
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes("video/init"))).toHaveLength(
      1,
    );
    expect(await adapter.reconcile!(account, j, "secret")).toBeUndefined();
  });
});

describe("TikTok session health", () => {
  it("reports a session healthy only while the token still belongs to the stored creator", async () => {
    const fetcher = vi.fn(async (raw: unknown, _options?: RequestInit) =>
      String(raw).includes("user/info") ? response({ user: { open_id: "creator" } }) : response({}),
    );
    const adapter = createTikTokAdapter(new SocialHttp(fetcher, () => 1000), () => 1000);
    await expect(adapter.healthCheck!(account, "secret")).resolves.toEqual({ ok: true });
    await expect(
      adapter.healthCheck!({ ...account, platformId: "someone-else" }, "secret"),
    ).resolves.toEqual({ ok: false, code: "denied" });
  });
  it("maps an expired token to expired without throwing", async () => {
    const expired = vi.fn(
      async (_raw?: unknown, _options?: RequestInit) => new Response("{}", { status: 401 }),
    );
    const adapter = createTikTokAdapter(new SocialHttp(expired, () => 1000), () => 1000);
    await expect(adapter.healthCheck!(account, "secret")).resolves.toEqual({
      ok: false,
      code: "expired",
    });
  });
});

describe("TikTok HTTP and status mapping", () => {
  const withStatus = (status: number, headers: Record<string, string> = {}) => {
    const fetcher = vi.fn(async (raw: unknown, _options?: RequestInit) =>
      String(raw).includes("user/info") ? new Response("{}", { status, headers }) : response({}),
    );
    return {
      fetcher,
      adapter: createTikTokAdapter(new SocialHttp(fetcher, () => 1000), () => 1000),
    };
  };
  it.each([
    [401, "expired"],
    [403, "denied"],
    [500, "unknown"],
  ])("maps HTTP %i from TikTok to %s before any publish request", async (status, code) => {
    const { adapter, fetcher } = withStatus(status);
    await expect(adapter.send(account, job(), "secret", noBody)).rejects.toMatchObject({ code });
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("/init/"))).toBe(false);
  });
  it("maps HTTP 429 to a rate limit that honours Retry-After", async () => {
    const { adapter } = withStatus(429, { "retry-after": "120" });
    await expect(adapter.send(account, job(), "secret", noBody)).rejects.toMatchObject({
      code: "rate_limit",
      retryAt: 121000,
    });
  });
  it("marks a FAILED status as rejected and an expired token during reconcile as expired", async () => {
    const failed = vi.fn(async (raw: unknown, _options?: RequestInit) =>
      String(raw).includes("status/fetch") ? response({ status: "FAILED" }) : response({}),
    );
    const adapter = createTikTokAdapter(new SocialHttp(failed, () => 1000), () => 1000);
    const j: SocialJob = { ...job(), preparation: { tiktokPublishId: "v_pub~123" } };
    await expect(adapter.reconcile!(account, j, "secret")).rejects.toMatchObject({
      code: "rejected",
    });
    const expired = vi.fn(
      async (_raw?: unknown, _options?: RequestInit) => new Response("{}", { status: 401 }),
    );
    const expiredAdapter = createTikTokAdapter(new SocialHttp(expired, () => 1000), () => 1000);
    await expect(expiredAdapter.reconcile!(account, j, "secret")).rejects.toMatchObject({
      code: "expired",
    });
  });
});

describe("TikTok Display API videos and metrics", () => {
  it("lists the creator's videos from a cursor and keeps only TikTok share links", async () => {
    const fetcher = vi.fn(async (raw: unknown, _options?: RequestInit) =>
      String(raw).includes("video/list")
        ? response({
            videos: [
              {
                id: "1234567890123",
                title: "Launch",
                create_time: 1767225600,
                share_url: "https://www.tiktok.com/@bycoda/video/1234567890123",
              },
              {
                id: "1234567890124",
                title: "Draft",
                create_time: 1767225700,
                share_url: "http://insecure.example/x",
              },
            ],
            cursor: 1767225000,
            has_more: true,
          })
        : response({}),
    );
    const adapter = createTikTokAdapter(new SocialHttp(fetcher), () => 1000);
    const page = await adapter.listPosts!(account, "secret", "1767000000");
    expect(page).toEqual({
      posts: [
        {
          id: "1234567890123",
          url: "https://www.tiktok.com/@bycoda/video/1234567890123",
          at: 1767225600000,
          text: "Launch",
        },
        { id: "1234567890124", url: undefined, at: 1767225700000, text: "Draft" },
      ],
      next: "1767225000",
    });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toContain("fields=");
    expect(JSON.parse(init!.body as string)).toEqual({ max_count: 20, cursor: 1767000000 });
  });
  it("refuses a malformed listing or a non-numeric cursor, the latter without any request", async () => {
    const malformed = vi.fn(async (_raw?: unknown, _options?: RequestInit) =>
      response({ videos: [] }),
    );
    await expect(
      createTikTokAdapter(new SocialHttp(malformed), () => 1000).listPosts!(account, "secret"),
    ).rejects.toMatchObject({ code: "rejected" });
    const none = vi.fn(async (_raw?: unknown, _options?: RequestInit) => response({}));
    await expect(
      createTikTokAdapter(new SocialHttp(none), () => 1000).listPosts!(account, "secret", "abc"),
    ).rejects.toMatchObject({ code: "rejected" });
    expect(none).not.toHaveBeenCalled();
  });
  it("reads basic metrics for the requested videos only and drops invalid counts", async () => {
    const fetcher = vi.fn(async (_raw?: unknown, _options?: RequestInit) =>
      response({
        videos: [
          { id: "1234567890123", view_count: 10, like_count: 2, comment_count: 1, share_count: 0 },
          { id: "999", view_count: 5 },
          { id: "1234567890124", view_count: -1 },
        ],
      }),
    );
    const adapter = createTikTokAdapter(new SocialHttp(fetcher), () => 1000);
    const metrics = await adapter.getAnalytics!(account, "secret", [
      "1234567890123",
      "1234567890123",
      "1234567890124",
    ]);
    expect(metrics).toEqual({
      "1234567890123": { views: 10, likes: 2, comments: 1, shares: 0 },
      "1234567890124": {
        views: undefined,
        likes: undefined,
        comments: undefined,
        shares: undefined,
      },
    });
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({
      filters: { video_ids: ["1234567890123", "1234567890124"] },
    });
  });
  it("refuses more than twenty videos or a non-numeric ID before any request", async () => {
    const fetcher = vi.fn(async (_raw?: unknown, _options?: RequestInit) =>
      response({ videos: [] }),
    );
    const adapter = createTikTokAdapter(new SocialHttp(fetcher), () => 1000);
    await expect(
      adapter.getAnalytics!(
        account,
        "secret",
        Array.from({ length: 21 }, (_, i) => String(i + 1)),
      ),
    ).rejects.toMatchObject({ code: "rejected" });
    await expect(adapter.getAnalytics!(account, "secret", ["abc"])).rejects.toMatchObject({
      code: "rejected",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
