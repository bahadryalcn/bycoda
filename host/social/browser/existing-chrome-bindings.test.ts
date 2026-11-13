import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { Cdp } from "../social-browser";
import { ExistingChromeBindings } from "./existing-chrome-bindings";

it("persists account-specific selection and closes only owned targets on stop", async () => {
  const dir = await mkdtemp(join(tmpdir(), "social-chrome-binding-"));
  const send = vi.fn(async (method: string, _params?: Record<string, unknown>) => {
    if (method === "Browser.getVersion") return { product: "Chrome/144.0.0.0" };
    if (method === "Target.getTargets")
      return {
        targetInfos: [
          {
            targetId: "selected",
            type: "page",
            url: "https://x.com/home",
            title: "Owner",
            browserContextId: "context",
          },
          { targetId: "private", type: "page", url: "https://example.com", title: "Private" },
        ],
      };
    if (method === "Target.createTarget") return { targetId: "owned" };
    if (method === "Target.attachToTarget") return { sessionId: "session" };
    return {};
  });
  const close = vi.fn();
  const connect = vi.fn(
    async () =>
      ({ send, close, on: vi.fn(), closed: new Promise<void>(() => {}) }) as unknown as Cdp,
  );
  try {
    const bindings = new ExistingChromeBindings(dir, connect);
    expect(await bindings.list("x")).toEqual([{ id: "selected", title: "Owner", site: "x.com" }]);
    await bindings.set("account", { platform: "x", targetId: "selected" });
    expect(await new ExistingChromeBindings(dir, connect).get("account")).toEqual({
      platform: "x",
      targetId: "selected",
    });
    expect(await bindings.get("other")).toBeUndefined();
    await bindings.open("account");
    await bindings.stop();
    expect(send).toHaveBeenCalledWith("Target.closeTarget", { targetId: "owned" });
    expect(send.mock.calls.some(([method]) => method === "Browser.close")).toBe(false);
    expect(
      send.mock.calls.some(
        ([method, params]) => method === "Target.closeTarget" && params?.targetId === "selected",
      ),
    ).toBe(false);
    await expect(bindings.open("account")).rejects.toThrow("stopping");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("rejects unsupported platforms, malformed selection and unavailable connections", async () => {
  const bindings = new ExistingChromeBindings("unused", async () => {
    throw new Error("secret-endpoint");
  });
  await expect(bindings.list("reddit")).rejects.toThrow("not supported");
  await expect(bindings.set("account", { platform: "x", targetId: "../secret" })).rejects.toThrow(
    "selection",
  );
  await expect(bindings.list("x")).rejects.toThrow("Chrome");
  await expect(bindings.list("x")).rejects.not.toThrow("secret-endpoint");
});

it("rejects older Chrome and closes its debugging transport", async () => {
  const close = vi.fn();
  const cdp = {
    send: vi.fn(async () => ({ product: "Chrome/143.0.0.0" })),
    close,
  } as unknown as Cdp;
  const bindings = new ExistingChromeBindings("unused", async () => cdp);
  await expect(bindings.list("x")).rejects.toThrow("Chrome 144");
  expect(close).toHaveBeenCalledOnce();
});

it("bounds a stalled connection and retires a connection that arrives after timeout", async () => {
  vi.useFakeTimers();
  let resolve!: (cdp: Cdp) => void;
  const close = vi.fn();
  const bindings = new ExistingChromeBindings(
    "unused",
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  try {
    const pending = expect(bindings.list("x")).rejects.toThrow("unavailable or permission denied");
    await vi.advanceTimersByTimeAsync(15_000);
    await pending;
    resolve({ close } as unknown as Cdp);
    await Promise.resolve();
    await Promise.resolve();
    expect(close).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
