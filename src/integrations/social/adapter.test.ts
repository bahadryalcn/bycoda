import { afterEach, describe, expect, it, vi } from "vitest";
import { SocialHttp } from "./adapter";

afterEach(() => vi.restoreAllMocks());

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
