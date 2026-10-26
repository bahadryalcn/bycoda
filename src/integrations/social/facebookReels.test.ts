import { describe, expect, it, vi } from "vitest";
import type { SocialAccount, SocialJob } from "../../features/social/model/social";
import { SocialHttp } from "./adapter";
import { createFacebookReelsAdapter, facebookReelContentIssue } from "./facebookReels";
import { contentSupport, createSocialAdapters } from "./platformAdapters";

const now = 1_800_000_000_000;
const account = (): SocialAccount => ({
  id: "page",
  platform: "facebook",
  platformId: "123",
  accountType: "page",
  connection: "oauth",
  name: "Bycoda",
  executorId: "host",
  scopes: ["pages_manage_posts", "pages_read_engagement"],
  connected: true,
  accessApproved: true,
  paused: false,
  grants: {},
  createdAt: 1,
});
const job = (): SocialJob => ({
  id: "job",
  operationId: "op",
  accountId: "page",
  projectIds: [],
  actorId: "owner",
  provider: "owner",
  dedupeKey: "key",
  kind: "publish",
  payload: {
    text: "Approved Reel",
    media: [{ kind: "video", uploadId: "upload" }],
    facebook: { target: "reel", durationSeconds: 12, width: 540, height: 960, frameRate: 30 },
  },
  status: "running",
  scheduledAt: now,
  attempts: 1,
  createdAt: now,
});
const mp4 = Uint8Array.from([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109]);
const published = () => ({
  id: "456",
  from: { id: "123" },
  published: true,
  status: {
    video_status: "ready",
    uploading_phase: { status: "complete" },
    processing_phase: { status: "complete" },
    publishing_phase: { status: "complete", publish_status: "published" },
  },
  permalink_url: "https://www.facebook.com/reel/456",
});
type Call = { url: URL; options?: RequestInit; body?: Record<string, unknown> };
function fixture(handler?: (call: Call, index: number) => unknown) {
  const calls: Call[] = [];
  const fetcher = vi.fn(async (raw: string | URL | Request, options?: RequestInit) => {
    const url = new URL(String(raw));
    const call: Call = {
      url,
      options,
      body: typeof options?.body === "string" ? JSON.parse(options.body) : undefined,
    };
    calls.push(call);
    const custom = handler?.(call, calls.length - 1);
    if (custom instanceof Response) return custom;
    if (custom) return Response.json(custom);
    if (url.pathname.endsWith("/me")) return Response.json({ id: "123" });
    if (url.hostname === "rupload.facebook.com") return Response.json({ success: true });
    if (call.body?.upload_phase === "start")
      return Response.json({
        video_id: "456",
        upload_url: "https://rupload.facebook.com/video-upload/v25.0/456",
      });
    if (call.body?.upload_phase === "finish") return Response.json({ success: true });
    return Response.json(published());
  });
  const http = new SocialHttp(fetcher, () => now);
  return { calls, fetcher, http, adapter: createFacebookReelsAdapter(http, "v25.0", () => now) };
}
const send = (
  f: ReturnType<typeof fixture>,
  j = job(),
  a = account(),
  checkpoint?: Parameters<ReturnType<typeof createFacebookReelsAdapter>["send"]>[4],
  guard?: () => Promise<void>,
) => f.adapter.send(a, j, "secret", async () => mp4, checkpoint, guard);
const writes = (f: ReturnType<typeof fixture>) =>
  f.calls.filter((call) => call.options?.method === "POST");

describe("Facebook explicit Reel publication", () => {
  it("uploads once to a fixed endpoint, approves finish and verifies exact public receipt", async () => {
    const f = fixture();
    const j = job();
    const stages: string[] = [];
    const guard = vi.fn(async () => {});
    expect(
      await send(
        f,
        j,
        account(),
        (state) => {
          stages.push(state.facebookReel!.stage);
        },
        guard,
      ),
    ).toEqual({ platformId: "456", url: "https://www.facebook.com/reel/456" });
    expect(stages).toEqual(["created", "uploading", "uploaded", "submitted"]);
    expect(guard).toHaveBeenCalledTimes(4);
    const upload = f.calls.find((call) => call.url.hostname === "rupload.facebook.com")!;
    expect(upload.options).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: "OAuth secret",
        offset: "0",
        file_size: "12",
        "Content-Type": "application/octet-stream",
      },
      body: mp4,
    });
    expect(writes(f).map((call) => call.body ?? "bytes")).toEqual([
      { upload_phase: "start" },
      "bytes",
      {
        video_id: "456",
        upload_phase: "finish",
        video_state: "PUBLISHED",
        description: "Approved Reel",
      },
    ]);
    expect(JSON.stringify(j.preparation)).not.toContain("secret");
    expect(JSON.stringify(j.preparation)).not.toContain("rupload");
  });
  it("supports a media-only Reel with an empty description", async () => {
    const f = fixture();
    const j = job();
    j.payload.text = "";
    await send(f, j);
    expect(writes(f).at(-1)?.body?.description).toBe("");
  });
  it("routes explicit Facebook Reels while preserving ordinary video rejection", async () => {
    const f = fixture();
    const adapters = createSocialAdapters(f.http);
    expect(contentSupport(account(), job())).toBeUndefined();
    expect(await adapters.facebook.send(account(), job(), "secret", async () => mp4)).toMatchObject(
      { platformId: "456" },
    );
    const ordinary = job();
    delete ordinary.payload.facebook;
    expect(contentSupport(account(), ordinary)).toBeTruthy();
  });
  it.each(["instagram", "youtube", "linkedin", "telegram"] as const)(
    "rejects Reel metadata on %s",
    (platform) => {
      expect(contentSupport({ ...account(), platform }, job())).toContain("Facebook Page API");
    },
  );
  it("rejects Reel metadata in browser mode", () => {
    expect(contentSupport({ ...account(), connection: "browser" }, job())).toContain(
      "Facebook Page API",
    );
  });
  it.each([
    { durationSeconds: 3 },
    { durationSeconds: 61 },
    { width: 539 },
    { height: 959 },
    { width: 960, height: 540 },
    { frameRate: 22 },
    { durationSeconds: NaN },
    { frameRate: Infinity },
  ])("rejects unsupported dimensions/duration/rate %j", (patch) => {
    const j = job();
    Object.assign(j.payload.facebook!, patch);
    expect(facebookReelContentIssue(account(), j)).toBeTruthy();
  });
  it("rejects remote videos, other media and extra options before any request", async () => {
    for (const patch of [
      { url: "https://cdn.test/v.mp4" },
      { alt: "alt" },
      { title: "title" },
      { kind: "image" as const },
    ]) {
      const f = fixture();
      const j = job();
      Object.assign(j.payload.media[0], patch);
      await expect(send(f, j)).rejects.toMatchObject({ code: "unsupported" });
      expect(f.calls).toHaveLength(0);
    }
    const j = job();
    Object.assign(j.payload.facebook!, { unknown: true });
    expect(facebookReelContentIssue(account(), j)).toBeTruthy();
  });
  it("rejects wrong Page identity before any upload", async () => {
    const f = fixture((call) => (call.url.pathname.endsWith("/me") ? { id: "999" } : undefined));
    await expect(send(f)).rejects.toMatchObject({ code: "denied" });
    expect(writes(f)).toHaveLength(0);
  });
  it("rejects missing read permission before any request", async () => {
    const f = fixture();
    await expect(
      send(f, job(), { ...account(), scopes: ["pages_manage_posts"] }),
    ).rejects.toMatchObject({ code: "denied" });
    expect(f.calls).toHaveLength(0);
  });
  it("rejects unexpected upload destination without transmitting bytes", async () => {
    const f = fixture((call) =>
      call.body?.upload_phase === "start"
        ? { video_id: "456", upload_url: "https://evil.test/upload" }
        : undefined,
    );
    await expect(send(f)).rejects.toMatchObject({ code: "unknown" });
    expect(f.calls.some((call) => call.url.hostname === "rupload.facebook.com")).toBe(false);
  });
  it("persists before upload and does not transfer on checkpoint failure", async () => {
    const f = fixture();
    const j = job();
    await expect(
      send(f, j, account(), (state) => {
        if (state.facebookReel?.stage === "uploading") throw new Error("store unavailable");
      }),
    ).rejects.toThrow("store unavailable");
    expect(f.calls.some((call) => call.url.hostname === "rupload.facebook.com")).toBe(false);
  });
  it("holds uncertain transfer and never uploads the same bytes again without acknowledgement", async () => {
    const f = fixture((call) => {
      if (call.url.hostname === "rupload.facebook.com") throw new Error("transport secret");
      if (call.url.hostname === "graph.facebook.com" && call.url.pathname.endsWith("/456"))
        return { id: "456", status: { uploading_phase: { status: "in_progress" } } };
    });
    const j = job();
    await expect(send(f, j)).rejects.toMatchObject({ code: "unknown" });
    expect(j.preparation?.facebookReel?.stage).toBe("uploading");
    await expect(send(f, j)).rejects.toMatchObject({ code: "unknown" });
    expect(f.calls.filter((call) => call.url.hostname === "rupload.facebook.com")).toHaveLength(1);
    expect(writes(f).filter((call) => call.body?.upload_phase === "finish")).toHaveLength(0);
  });
  it("resumes only after exact completed transfer acknowledgement without uploading again", async () => {
    let fail = true;
    const f = fixture((call) => {
      if (call.url.hostname === "rupload.facebook.com" && fail) {
        fail = false;
        throw new Error("lost");
      }
    });
    const j = job();
    await expect(send(f, j)).rejects.toMatchObject({ code: "unknown" });
    expect(await send(f, j)).toMatchObject({ platformId: "456" });
    expect(f.calls.filter((call) => call.url.hostname === "rupload.facebook.com")).toHaveLength(1);
  });
  it("revalidates approval after transfer and before finish", async () => {
    const f = fixture();
    const j = job();
    const guard = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("owner stopped"));
    await expect(send(f, j, account(), undefined, guard)).rejects.toThrow("owner stopped");
    expect(j.preparation?.facebookReel?.stage).toBe("uploaded");
    expect(writes(f).some((call) => call.body?.upload_phase === "finish")).toBe(false);
  });
  it("an uncertain finish reconciles the same video without any repeated writes", async () => {
    const f = fixture((call) => {
      if (call.body?.upload_phase === "finish") throw new Error("lost response");
    });
    const j = job();
    await expect(send(f, j)).rejects.toMatchObject({ code: "unknown" });
    expect(j.preparation?.facebookReel?.stage).toBe("submitted");
    const count = writes(f).length;
    expect(await send(f, j)).toMatchObject({ platformId: "456" });
    expect(await f.adapter.reconcile!(account(), j, "secret")).toMatchObject({ platformId: "456" });
    expect(writes(f)).toHaveLength(count);
  });
  it.each(["uploading", "submitted"] as const)(
    "rechecks authorization after the %s checkpoint",
    async (stage) => {
      const f = fixture();
      const j = job();
      let revoked = false;
      await expect(
        send(
          f,
          j,
          account(),
          (state) => {
            if (state.facebookReel?.stage === stage) revoked = true;
          },
          async () => {
            if (revoked) throw new Error("permission revoked");
          },
        ),
      ).rejects.toThrow("permission revoked");
      if (stage === "uploading")
        expect(f.calls.some((call) => call.url.hostname === "rupload.facebook.com")).toBe(false);
      expect(writes(f).some((call) => call.body?.upload_phase === "finish")).toBe(false);
    },
  );
  it("checkpoint failure before finish cannot cause a second finish", async () => {
    const f = fixture();
    const j = job();
    await expect(
      send(f, j, account(), (state) => {
        if (state.facebookReel?.stage === "submitted") throw new Error("store failed");
      }),
    ).rejects.toThrow("store failed");
    expect(writes(f).some((call) => call.body?.upload_phase === "finish")).toBe(false);
    await send(f, j);
    expect(writes(f).some((call) => call.body?.upload_phase === "finish")).toBe(false);
  });
  it.each([
    { published: false },
    { id: "789" },
    { from: { id: "789" } },
    {
      status: {
        video_status: "ready",
        publishing_phase: { status: "complete", publish_status: "draft" },
      },
      published: false,
    },
  ])("does not turn a non-public/wrong receipt into delivery %j", async (patch) => {
    const f = fixture((call) =>
      call.url.hostname === "graph.facebook.com" && call.url.pathname.endsWith("/456")
        ? { ...published(), ...patch }
        : undefined,
    );
    await expect(send(f)).rejects.toMatchObject({ code: "unknown" });
  });
  it("processing remains processing after finish success, without another finish on retry", async () => {
    const f = fixture((call) =>
      call.url.hostname === "graph.facebook.com" && call.url.pathname.endsWith("/456")
        ? {
            ...published(),
            published: false,
            status: { video_status: "ready", publishing_phase: { status: "in_progress" } },
          }
        : undefined,
    );
    const j = job();
    await expect(send(f, j)).rejects.toMatchObject({ code: "processing" });
    await expect(send(f, j)).rejects.toMatchObject({ code: "processing" });
    expect(writes(f).filter((call) => call.body?.upload_phase === "finish")).toHaveLength(1);
  });
  it("platform processing errors reject without another upload", async () => {
    const f = fixture((call) =>
      call.url.hostname === "graph.facebook.com" && call.url.pathname.endsWith("/456")
        ? { ...published(), status: { video_status: "error" } }
        : undefined,
    );
    await expect(send(f)).rejects.toMatchObject({ code: "rejected" });
  });
  it("rejects payload changes and stale preparation without network requests", async () => {
    const f = fixture();
    const j = job();
    await send(f, j);
    const count = f.calls.length;
    j.payload.text = "Changed";
    await expect(send(f, j)).rejects.toMatchObject({ code: "rejected" });
    expect(f.calls).toHaveLength(count);
    j.payload.text = "Approved Reel";
    j.preparation!.facebookReel!.createdAt = now - 86_400_001;
    await expect(send(f, j)).rejects.toMatchObject({ code: "rejected" });
    expect(f.calls).toHaveLength(count);
  });
  it.each([
    "https://evil.test/secret",
    "https://www.facebook.com/reel/999",
    "https://www.facebook.com/123",
    "https://www.facebook.com/reel/456?token=secret",
    "https://www.facebook.com/video.php?v=999",
  ])("does not emit unrelated/untrusted permalink %s", async (permalink_url) => {
    const f = fixture((call) =>
      call.url.hostname === "graph.facebook.com" && call.url.pathname.endsWith("/456")
        ? { ...published(), permalink_url }
        : undefined,
    );
    expect(await send(f)).toEqual({ platformId: "456" });
  });
  it.each([
    "https://www.facebook.com/123/videos/456/",
    "https://www.facebook.com/video.php?v=456",
    "https://www.facebook.com/watch/?v=456",
  ])("accepts exact video permalink %s", async (permalink_url) => {
    const f = fixture((call) =>
      call.url.hostname === "graph.facebook.com" && call.url.pathname.endsWith("/456")
        ? { ...published(), permalink_url }
        : undefined,
    );
    expect(await send(f)).toEqual({ platformId: "456", url: permalink_url });
  });
  it("upload transport validates destination identifiers and MP4 before network access", async () => {
    const f = fixture();
    for (const [version, videoId, bytes] of [
      ["v25.0/evil", "456", mp4],
      ["v25.0", "456?token=x", mp4],
      ["v25.0", "456", new Uint8Array(12)],
    ] as const)
      await expect(
        f.http.uploadFacebookReel(version, videoId, "secret", bytes),
      ).rejects.toMatchObject({ code: "unsupported" });
    expect(f.calls).toHaveLength(0);
  });
});
