// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyPreparedNewThreadBackground,
  clearPreparedNewThreadBackground,
  prepareNewThreadBackgroundEffect,
  disposePreparedBackgroundEffects,
} from "./newThreadBackgroundEffects";

afterEach(() => {
  clearPreparedNewThreadBackground();
  disposePreparedBackgroundEffects();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockEffectWorker(automatic = true) {
  const created = {
    onmessage: null as null | ((event: { data: unknown }) => void),
    onerror: null as null | (() => void),
    onmessageerror: null as null | (() => void),
    terminate: vi.fn(),
    postMessage: vi.fn((message: { id: number; kind: string; sourceKey: string }) => {
      if (automatic) queueMicrotask(() => answer(message));
    }),
  };
  const keys = new Set<string>();
  function answer(message = created.postMessage.mock.calls.at(-1)![0]) {
    if (message.kind === "load") keys.add(message.sourceKey);
    created.onmessage?.({ data: { id: message.id, sourceKeys: [...keys],
      ...(message.kind === "render" ? { result: new Blob([message.sourceKey]) } : {}) } });
  }
  vi.stubGlobal("Worker", vi.fn(function () { return created; }));
  return { created, answer };
}

describe("new-thread background effects", () => {
  it("serializes actual load/render pairs so queued projects cannot evict the current source", async () => {
    const { created, answer } = mockEffectWorker(false);
    const fetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }));
    vi.stubGlobal("fetch", fetch);
    const first = prepareNewThreadBackgroundEffect("first?v=1", "asset://first", "dither", false);
    const second = prepareNewThreadBackgroundEffect("second?v=1", "asset://second", "dither", false);
    await vi.waitFor(() => expect(created.postMessage).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledTimes(1);
    answer();
    await vi.waitFor(() => expect(created.postMessage).toHaveBeenCalledTimes(2));
    expect(created.postMessage.mock.calls[1][0].kind).toBe("render");
    expect(fetch).toHaveBeenCalledTimes(1);
    answer(); await first;
    await vi.waitFor(() => expect(created.postMessage).toHaveBeenCalledTimes(3));
    answer();
    await vi.waitFor(() => expect(created.postMessage).toHaveBeenCalledTimes(4));
    answer(); await second;
  });
  it("binds cached image identity to actual source URL as well as revision key", async () => {
    mockEffectWorker();
    const fetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }));
    vi.stubGlobal("fetch", fetch);
    const first = await prepareNewThreadBackgroundEffect("same?v=1", "asset://first", "dither", false);
    const second = await prepareNewThreadBackgroundEffect("same?v=1", "asset://second", "dither", false);
    expect(await first.text()).toContain("asset://first");
    expect(await second.text()).toContain("asset://second");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("disposes idle processing resources without revoking the currently displayed image", async () => {
    vi.useFakeTimers();
    const { created } = mockEffectWorker();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) })));
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
    const NativeURL = URL;
    const revoke = vi.fn();
    vi.stubGlobal("URL", class extends NativeURL {
      static createObjectURL = vi.fn(() => "blob:active");
      static revokeObjectURL = revoke;
    });
    try {
      await applyPreparedNewThreadBackground("active?v=1", "asset://active", "dither", false);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(created.terminate).toHaveBeenCalledOnce();
      expect(revoke).not.toHaveBeenCalled();
      expect(document.documentElement.style.getPropertyValue("--chat-background-image")).toContain("blob:active");
    } finally { vi.useRealTimers(); }
  });
  it("fences late source fetches after disposal and permits a fresh original pipeline", async () => {
    const { created } = mockEffectWorker();
    let release!: (response: { ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }) => void;
    const old = new Promise<{ ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }>((resolve) => { release = resolve; });
    const response = { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(old).mockResolvedValue(response));
    const first = prepareNewThreadBackgroundEffect("same?v=1", "asset://same", "dither", false);
    const outcome = expect(first).rejects.toThrow("superseded");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    disposePreparedBackgroundEffects();
    await expect(prepareNewThreadBackgroundEffect("same?v=1", "asset://same", "dither", false)).resolves.toBeInstanceOf(Blob);
    release(response); await outcome;
    expect(created.postMessage).toHaveBeenCalledTimes(2);
  });
  it("does not turn an observer timeout into proof that an unknown fetch settled", async () => {
    vi.useFakeTimers();
    const { created } = mockEffectWorker();
    let release!: (response: { ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }) => void;
    const unknown = new Promise<{ ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }>((resolve) => { release = resolve; });
    const fetch = vi.fn(() => unknown);
    vi.stubGlobal("fetch", fetch);
    try {
      const first = prepareNewThreadBackgroundEffect("pending?v=1", "asset://pending", "dither", false);
      const outcome = expect(first).rejects.toThrow("still pending");
      await vi.advanceTimersByTimeAsync(21_000); await outcome;
      await expect(prepareNewThreadBackgroundEffect("pending?v=1", "asset://pending", "dither", false)).rejects.toThrow("still pending");
      expect(fetch).toHaveBeenCalledOnce();
      release({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
      await vi.waitFor(() => expect(created.postMessage).toHaveBeenCalledTimes(2));
    } finally { vi.useRealTimers(); }
  });
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
    vi.stubGlobal("Worker", vi.fn(function () {
      return { onmessage: null, onerror: null, onmessageerror: null, postMessage: vi.fn(), terminate: vi.fn() };
    }));
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
