// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyPreparedNewThreadBackground,
  clearPreparedNewThreadBackground,
  prepareNewThreadBackgroundEffect,
} from "./newThreadBackgroundEffects";

afterEach(() => {
  clearPreparedNewThreadBackground();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("new-thread background effects", () => {
  it("uses the original asset directly for None so animation is preserved", async () => {
    const fetch = vi.fn();
    const worker = vi.fn(() => {
      throw new Error("None must not start a worker");
    });
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("Worker", worker);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    await applyPreparedNewThreadBackground(
      "/background.gif?v=101",
      "asset://localhost/background.gif?v=101",
      "none",
      false,
    );

    expect(fetch).not.toHaveBeenCalled();
    expect(worker).not.toHaveBeenCalled();
    expect(document.documentElement.style.getPropertyValue("--chat-background-image")).toContain(
      "background.gif?v=101",
    );
    expect(document.documentElement.classList).toContain("chat-background-effect-ready");
  });

  it("uses the original asset for Gradient Blur without starting the image worker", async () => {
    const fetch = vi.fn();
    const worker = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("Worker", worker);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    await applyPreparedNewThreadBackground(
      "/background.png?v=102",
      "asset://localhost/background.png?v=102",
      "gradient-blur",
      false,
    );

    expect(fetch).not.toHaveBeenCalled();
    expect(worker).not.toHaveBeenCalled();
    expect(document.documentElement.classList).toContain("chat-background-gradient-blur");
    expect(document.documentElement.classList).toContain("chat-background-effect-ready");
    expect(document.documentElement.style.getPropertyValue("--chat-background-image")).toContain(
      "background.png?v=102",
    );

    await applyPreparedNewThreadBackground(
      "/background.png?v=102",
      "asset://localhost/background.png?v=102",
      "none",
      false,
    );
    expect(document.documentElement.classList).not.toContain("chat-background-gradient-blur");
  });

  it("drops rejected source promises so transient failures can retry", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("temporary failure"));
    vi.stubGlobal("fetch", fetch);
    const sourceKey = `/background.png?v=${Date.now()}`;

    await expect(
      prepareNewThreadBackgroundEffect(
        sourceKey,
        "asset://localhost/background.png",
        "dither",
        false,
      ),
    ).rejects.toThrow("temporary failure");
    await expect(
      prepareNewThreadBackgroundEffect(
        sourceKey,
        "asset://localhost/background.png",
        "dither",
        false,
      ),
    ).rejects.toThrow("temporary failure");

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("settles pending requests when the worker crashes and recreates it on retry", async () => {
    const workers: Array<{
      onerror: (() => void) | null;
      onmessage: ((event: { data: unknown }) => void) | null;
      onmessageerror: (() => void) | null;
      postMessage: ReturnType<typeof vi.fn>;
      terminate: ReturnType<typeof vi.fn>;
    }> = [];
    vi.stubGlobal(
      "Worker",
      vi.fn(function () {
        const created = {
          onerror: null,
          onmessage: null,
          onmessageerror: null,
          postMessage: vi.fn(),
          terminate: vi.fn(),
        };
        workers.push(created);
        return created;
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) })),
    );
    const sourceKey = `/background.png?v=${Date.now()}`;

    const first = prepareNewThreadBackgroundEffect(sourceKey, "asset://x/a.png", "dither", false);
    await vi.waitFor(() => expect(workers[0]?.postMessage).toHaveBeenCalledTimes(1));
    workers[0]!.onerror?.();
    await expect(first).rejects.toThrow("stopped unexpectedly");
    expect(workers[0]!.terminate).toHaveBeenCalled();

    const retry = prepareNewThreadBackgroundEffect(sourceKey, "asset://x/a.png", "dither", false);
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    await vi.waitFor(() => expect(workers[1]?.postMessage).toHaveBeenCalledTimes(1));
    const load = workers[1]!.postMessage.mock.calls[0]![0] as { id: number; kind: string };
    expect(load.kind).toBe("load");
    workers[1]!.onmessage?.({ data: { id: load.id } });
    await vi.waitFor(() => expect(workers[1]!.postMessage).toHaveBeenCalledTimes(2));
    const render = workers[1]!.postMessage.mock.calls[1]![0] as { id: number };
    workers[1]!.onmessage?.({ data: { id: render.id, result: new Blob(["x"]) } });
    await expect(retry).resolves.toBeInstanceOf(Blob);
  });

  it("rejects a request the worker never answers", async () => {
    vi.useFakeTimers();
    // Worker state is module-level, so this reuses the silent mock worker from above.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) })),
    );
    try {
      const hung = prepareNewThreadBackgroundEffect(
        `/background.png?v=${Date.now()}`,
        "asset://x/b.png",
        "dither",
        false,
      );
      const outcome = expect(hung).rejects.toThrow("did not respond");
      await vi.advanceTimersByTimeAsync(21_000);
      await outcome;
    } finally {
      vi.useRealTimers();
    }
  });
});
