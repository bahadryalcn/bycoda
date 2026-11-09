import { afterEach, describe, expect, it, vi } from "vitest";
import { SocialHttp, SocialPlatformError, fallbackAllowed, retryAfter } from "./adapter";
import type { SocialJob } from "../../features/social/model/social";

afterEach(() => vi.restoreAllMocks());

describe("rate-limit delays", () => {
  const now = 1_000_000;
  it("reads Retry-After in seconds before any reset header", () => {
    expect(retryAfter(new Headers({ "Retry-After": "5", "X-Ratelimit-Reset": "90" }), now)).toBe(
      now + 5_000,
    );
  });
  it("reads Reddit's X-Ratelimit-Reset as seconds until the window resets", () => {
    expect(retryAfter(new Headers({ "X-Ratelimit-Reset": "30" }), now)).toBe(now + 30_000);
  });
  it("reads X's x-rate-limit-reset as an epoch time in seconds", () => {
    const reset = Math.floor((now + 45_000) / 1000);
    expect(retryAfter(new Headers({ "x-rate-limit-reset": String(reset) }), now)).toBe(
      reset * 1000,
    );
  });
  it("falls back to 60 seconds when no header is usable", () => {
    expect(retryAfter(new Headers({ "X-Ratelimit-Reset": "0" }), now)).toBe(now + 60_000);
    expect(retryAfter(new Headers(), now)).toBe(now + 60_000);
  });
});

describe("host allowlist", () => {
  it("allows the Reddit OAuth API host and refuses other Reddit hosts", async () => {
    const fetcher = vi.fn(async () => Response.json({ name: "me" }));
    const http = new SocialHttp(fetcher);
    await expect(
      http.request("https://oauth.reddit.com/api/v1/me", "token"),
    ).resolves.toMatchObject({
      value: { name: "me" },
    });
    await expect(http.request("https://www.reddit.com/api/v1/me", "token")).rejects.toMatchObject({
      code: "denied",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("TikTok body errors", () => {
  const tiktok = (error: unknown) =>
    new SocialHttp(
      vi.fn(async () => Response.json({ error }, { status: 200 })),
      () => 1000,
    ).request("https://open.tiktokapis.com/v2/post/publish/video/init/", "token");
  it("maps an invalid access token in the body to expired", async () => {
    await expect(tiktok({ code: "access_token_invalid" })).rejects.toMatchObject({
      code: "expired",
    });
  });
  it("maps a body quota error to rate_limit with a retry time", async () => {
    await expect(tiktok({ code: "rate_limit_exceeded" })).rejects.toMatchObject({
      code: "rate_limit",
      retryAt: 61_000,
    });
  });
});

describe("Graph error codes", () => {
  const graph = (code: number) =>
    new SocialHttp(
      vi.fn(async () => Response.json({ error: { code, message: "synthetic" } }, { status: 400 })),
      () => 1000,
    ).request("https://graph.facebook.com/v25.0/123/messages", "token");
  it.each([4, 32, 613, 80007, 130429, 131056])(
    "treats throughput code %i as rate_limit with a retry time",
    async (code) => {
      await expect(graph(code)).rejects.toMatchObject({ code: "rate_limit", retryAt: 61_000 });
    },
  );
  it("refuses a message outside the 24-hour WhatsApp window with the template reason", async () => {
    await expect(graph(131047)).rejects.toMatchObject({
      code: "rejected",
      detail: { reasonCode: "whatsapp.window_closed_template_required" },
    });
  });
});

describe("LinkedIn part upload", () => {
  it("returns the part ETag that the multipart finalize call needs", async () => {
    const http = new SocialHttp(
      vi.fn(async () => new Response(null, { status: 200, headers: { etag: '"part-1"' } })),
    );
    await expect(
      http.uploadLinkedInImage(
        "https://www.linkedin.com/dms-uploads/part",
        "token",
        new Uint8Array(4),
      ),
    ).resolves.toEqual({ etag: '"part-1"' });
  });
});

describe("Social upload deadlines", () => {
  it("sizes the exact serialized request without invoking toJSON twice", async () => {
    const toJSON = vi.fn(() => ({ text: "one exact request" }));
    const fetcher = vi.fn(async (_input: unknown, _options?: RequestInit) =>
      Response.json({ ok: true, result: {} }),
    );
    await new SocialHttp(fetcher).telegram("sendMessage", "123:token", { toJSON });
    expect(toJSON).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.body).toBe('{"text":"one exact request"}');
  });
  it("scales binary and multipart budgets while keeping ordinary reads short", async () => {
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation(() => new AbortController().signal);
    const fetcher = vi.fn(async () => Response.json({ ok: true, result: {} }));
    const http = new SocialHttp(fetcher);
    await http.request("https://api.x.com/2/users/me", "token");
    const bytes = new Uint8Array(4 * 1024 * 1024);
    await http.uploadLinkedInImage("https://www.linkedin.com/dms-uploads/upload", "token", bytes);
    const body = new FormData();
    body.set("chat_id", "123");
    body.set("photo", new Blob([bytes]));
    await http.telegram("sendPhoto", "123:token", body);
    expect(timeout.mock.calls[0][0]).toBe(30_000);
    expect(timeout.mock.calls[1][0]).toBe(62_000);
    expect(timeout.mock.calls[2][0]).toBeGreaterThanOrEqual(62_000);
    expect(timeout.mock.calls[2][0]).toBeLessThanOrEqual(15 * 60_000);
  });

  it("retains the video latency allowance and adds transfer time", async () => {
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation(() => new AbortController().signal);
    const http = new SocialHttp(vi.fn(async () => Response.json({ success: true })));
    const bytes = new Uint8Array(4 * 1024 * 1024);
    bytes.set(new TextEncoder().encode("ftyp"), 4);
    await http.uploadFacebookReel("v25.0", "123", "token", bytes);
    await http.request(
      "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=held",
      "token",
      {
        method: "PUT",
        body: bytes,
      },
    );
    expect(timeout.mock.calls.map(([duration]) => duration)).toEqual([152_000, 152_000]);
  });

  it("holds a timed-out publication as unknown and never retries the network request", async () => {
    const signal = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal.signal);
    const fetcher = vi.fn(async () => {
      signal.abort();
      throw new DOMException("secret provider address", "TimeoutError");
    });
    const http = new SocialHttp(fetcher);
    await expect(
      http.telegram("sendMessage", "123:token", { text: "publish once" }),
    ).rejects.toMatchObject({
      code: "unknown",
      message: "Platform outcome is uncertain. Review before another send.",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("human verification errors", () => {
  it("uses the needs_human message and keeps only non-secret detail", () => {
    const error = new SocialPlatformError("needs_human", undefined, {
      url: "https://x.com/account/access",
      screenshotId: "shot-1",
      reasonCode: "captcha",
    });
    expect(error.code).toBe("needs_human");
    expect(error.message).toBe(
      "Human verification is required in the browser. The job is waiting for you.",
    );
    expect(error.detail).toEqual({
      url: "https://x.com/account/access",
      screenshotId: "shot-1",
      reasonCode: "captcha",
    });
  });
});

describe("hybrid fallback", () => {
  const job = (dispatchedAt?: number) => ({ dispatchedAt }) as SocialJob;
  const rateLimited = () => new SocialPlatformError("rate_limit", Date.now() + 60_000);

  it("allows the browser after an API rate limit when no external submit happened", () => {
    expect(fallbackAllowed(job(), rateLimited(), true)).toBe(true);
  });

  it("allows the browser when the API does not support the operation", () => {
    expect(fallbackAllowed(job(), new SocialPlatformError("unsupported"), true)).toBe(true);
  });

  it("never falls back once the job was dispatched, even for a retryable error", () => {
    expect(fallbackAllowed(job(1_700_000_000_000), rateLimited(), true)).toBe(false);
    expect(
      fallbackAllowed(job(1_700_000_000_000), new SocialPlatformError("unsupported"), true),
    ).toBe(false);
  });

  it("does not fall back when no browser recipe supports the operation", () => {
    expect(fallbackAllowed(job(), rateLimited(), false)).toBe(false);
  });

  it("does not fall back for auth, denial, rejection or uncertain outcomes", () => {
    for (const code of ["expired", "denied", "rejected", "unknown", "needs_human"] as const)
      expect(fallbackAllowed(job(), new SocialPlatformError(code), true), code).toBe(false);
  });

  it("does not fall back for errors that are not platform errors", () => {
    expect(fallbackAllowed(job(), new Error("network"), true)).toBe(false);
  });
});
