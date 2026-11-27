import { afterEach, expect, it, vi } from "vitest";
import { Cdp, MAX_CDP_FRAME_LENGTH, cdpPage, systemBrowserLauncher } from "./social-browser";
import { SocialBrowserLaunch } from "./social-browser-launch";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Window } from "happy-dom";

class Socket extends EventTarget {
  static last: Socket;
  sent: { id: number; method: string }[] = [];
  constructor() {
    super();
    Socket.last = this;
    queueMicrotask(() => this.dispatchEvent(new Event("open")));
  }
  send(value: string) {
    this.sent.push(JSON.parse(value));
  }
  close() {
    this.dispatchEvent(new Event("close"));
  }
  answer(value: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) }));
  }
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("times out a stuck browser command, ignores late replies and can continue with another command", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", Socket);
  const pending = Cdp.connect("ws://127.0.0.1:1");
  await vi.advanceTimersByTimeAsync(0);
  const cdp = await pending;
  const first = cdp.send("Runtime.evaluate");
  const rejected = expect(first).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(30000);
  await rejected;
  Socket.last.answer({ id: 1, result: { ignored: true } });
  const second = cdp.send("Page.enable");
  Socket.last.answer({ id: 2, result: { ok: true } });
  await expect(second).resolves.toEqual({ ok: true });
  cdp.close();
  expect(vi.getTimerCount()).toBe(0);
});
async function connected() {
  vi.stubGlobal("WebSocket", Socket);
  const pending = Cdp.connect("ws://127.0.0.1:1");
  await Promise.resolve();
  return pending;
}
/** EventTarget reports a throwing listener as an uncaught exception on a later tick. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

it("drops malformed and oversized frames without disturbing later replies", async () => {
  const cdp = await connected();
  const events = vi.fn();
  cdp.on(events);
  const raw = (data: unknown) =>
    Socket.last.dispatchEvent(new MessageEvent("message", { data: data as never }));
  for (const frame of [
    "{not json",
    "null",
    "[]",
    "7",
    '"text"',
    new ArrayBuffer(4),
    "x".repeat(MAX_CDP_FRAME_LENGTH + 1),
    '{"params":{}}',
    '{"method":42}',
  ])
    raw(frame);
  expect(events).not.toHaveBeenCalled();
  const command = cdp.send("Page.enable");
  Socket.last.answer({ id: 1, result: { ok: true } });
  await expect(command).resolves.toEqual({ ok: true });
  await settle();
  cdp.close();
});

it("isolates a throwing or rejecting listener from siblings, replies and the process", async () => {
  const cdp = await connected();
  const seen: string[] = [];
  cdp.on(() => {
    throw new Error("sync failure");
  });
  cdp.on(async () => {
    throw new Error("async failure");
  });
  cdp.on((method, _params, sessionId) => {
    seen.push(`${method}:${sessionId ?? ""}`);
  });
  Socket.last.answer({ method: "Network.loadingFinished", params: {}, sessionId: "s1" });
  Socket.last.answer({ method: "Page.frameNavigated", params: null, sessionId: 5 });
  expect(seen).toEqual(["Network.loadingFinished:s1", "Page.frameNavigated:"]);
  const command = cdp.send("Page.enable");
  Socket.last.answer({ id: 1, result: { ok: true } });
  await expect(command).resolves.toEqual({ ok: true });
  await settle();
  cdp.close();
});

it("fails the matching command for an error reply of any shape and ignores foreign ids", async () => {
  const cdp = await connected();
  const named = cdp.send("A");
  const bare = cdp.send("B");
  const odd = cdp.send("C");
  const shapeless = cdp.send("D");
  Socket.last.answer({ id: "1", result: {} });
  Socket.last.answer({ id: null, error: { message: "ignored" } });
  Socket.last.answer({ id: 1, error: { message: "No such target" } });
  Socket.last.answer({ id: 2, error: "broken" });
  Socket.last.answer({ id: 3, error: null, result: ["not an object"] });
  Socket.last.answer({ id: 4, error: { message: { nested: true } } });
  await expect(named).rejects.toThrow("No such target");
  await expect(bare).rejects.toThrow("Browser command failed.");
  await expect(odd).resolves.toEqual({});
  await expect(shapeless).rejects.toThrow("Browser command failed.");
  cdp.close();
});

it("rejects in-flight work and frees timers when the browser closes", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", Socket);
  const pending = Cdp.connect("ws://127.0.0.1:1");
  await vi.advanceTimersByTimeAsync(0);
  const cdp = await pending;
  const command = cdp.send("Page.navigate");
  const rejected = expect(command).rejects.toThrow("Browser closed");
  cdp.close();
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
});

it("captures only allowlisted platform responses and skips unrelated GraphQL envelopes", async () => {
  let event!: (method: string, params: unknown, session: string) => void;
  const unsubscribe = vi.fn();
  const cdp = {
    on: (listener: typeof event) => {
      event = listener;
      return unsubscribe;
    },
    closed: new Promise<void>(() => {}),
  } as unknown as Cdp;
  const send = vi.fn(async (_method: string, params?: Record<string, unknown>) => ({
    body:
      params?.requestId === "actual"
        ? '{"data":{"story_create":{"id":"1"}}}'
        : '{"data":{"viewer":{}}}',
    base64Encoded: false,
  }));
  const page = cdpPage(cdp, "own-session", send as never);
  const capture = page.watchResponse(
    /\/api\/graphql\//,
    (body) => !!JSON.parse(body).data.story_create,
  );
  const response = (id: string, origin: string, session = "own-session") => {
    event(
      "Network.responseReceived",
      { requestId: id, response: { url: `${origin}/api/graphql/` } },
      session,
    );
    event("Network.loadingFinished", { requestId: id, encodedDataLength: 100 }, session);
  };
  response("foreign", "https://www.facebook.com", "another-session");
  response("external", "https://untrusted.example");
  response("unrelated", "https://www.facebook.com");
  response("actual", "https://www.facebook.com");
  await expect(capture.body(1000)).resolves.toContain("story_create");
  expect(send.mock.calls.map((call) => call[1]?.requestId)).toEqual(["unrelated", "actual"]);
  expect(unsubscribe).toHaveBeenCalledOnce();
});

it("limits cookie identity reads to known platform origins and makes a stopped watcher inert", async () => {
  const unsubscribe = vi.fn();
  const cdp = { on: () => unsubscribe, closed: new Promise<void>(() => {}) } as unknown as Cdp;
  const send = vi.fn(async () => ({ cookies: [{ name: "ds_user_id", value: "123" }] }));
  const page = cdpPage(cdp, "session", send as never);
  await expect(page.cookies(["https://attacker.example"])).rejects.toMatchObject({
    code: "denied",
  });
  expect(send).not.toHaveBeenCalled();
  await expect(page.cookies(["https://www.reddit.com"])).rejects.toMatchObject({ code: "denied" });
  await expect(page.cookies(["https://www.instagram.com"])).resolves.toEqual([
    { name: "ds_user_id", value: "123" },
  ]);
  const capture = page.watchResponse(/anything/);
  capture.stop();
  await expect(capture.body(1000)).resolves.toBeUndefined();
});

it("reads the exact Reddit response without accepting an off-origin lookalike", async () => {
  let event!: (method: string, params: unknown, session: string) => void;
  const cdp = {
    on: (listener: typeof event) => {
      event = listener;
      return vi.fn();
    },
    closed: new Promise<void>(() => {}),
  } as unknown as Cdp;
  const body = '{"data":{"createPost":{"post":{"id":"t3_abc123"}}}}';
  const send = vi.fn(async (_method: string, _params: Record<string, unknown>) => ({ body }));
  const page = cdpPage(cdp, "reddit", send as never);
  const capture = page.watchResponse(/\/svc\/shreddit\/graphql$/);
  for (const [requestId, origin] of [
    ["foreign", "https://reddit.example"],
    ["own", "https://www.reddit.com"],
  ]) {
    event(
      "Network.responseReceived",
      {
        requestId,
        response: { url: `${origin}/svc/shreddit/graphql` },
      },
      "reddit",
    );
    event("Network.loadingFinished", { requestId, encodedDataLength: body.length }, "reddit");
  }
  await expect(capture.body(1_000)).resolves.toBe(body);
  expect(send.mock.calls.map((call) => call[1].requestId)).toEqual(["own"]);
});

it("dispatches input to a uniquely marked shadow button and refuses a covering element", async () => {
  const window = new Window();
  window.document.body.innerHTML = "<test-composer></test-composer><aside></aside>";
  const host = window.document.querySelector("test-composer")!;
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = '<button data-bycoda-web-control="publish">Post</button>';
  const button = shadow.querySelector("button")!;
  const cover = window.document.querySelector("aside")!;
  Object.defineProperties(button, {
    getClientRects: { value: () => [{ x: 10, y: 20, width: 40, height: 20 }] },
    getBoundingClientRect: { value: () => ({ x: 10, y: 20, width: 40, height: 20 }) },
    scrollIntoView: { value: () => {} },
  });
  const hit = vi.fn(() => host);
  Object.defineProperty(window.document, "elementFromPoint", { value: hit });
  Object.defineProperty(shadow, "elementFromPoint", { value: () => button });
  const send = vi.fn(async (method: string, params?: Record<string, unknown>) =>
    method === "Runtime.evaluate"
      ? { result: { value: window.eval(String(params?.expression)) } }
      : {},
  );
  const page = cdpPage({} as Cdp, "reddit", send as never);
  const target = '[data-bycoda-web-control="publish"]';
  await page.click(target);
  expect(send.mock.calls.filter(([method]) => method === "Input.dispatchMouseEvent")).toHaveLength(
    3,
  );
  hit.mockReturnValue(cover);
  await expect(page.click(target)).rejects.toThrow("Page element is missing.");
  expect(send.mock.calls.filter(([method]) => method === "Input.dispatchMouseEvent")).toHaveLength(
    3,
  );
});

it.each(["missing endpoint", "CDP connection"])(
  "failed %s retires the exact original capsule before returning failure",
  async (failure) => {
    const profile = await mkdtemp(join(tmpdir(), "social-cdp-capsule-"));
    const capsule = {
      profile,
      exit: new Promise<void>(() => {}),
      failed: failure === "missing endpoint",
      start: vi.fn(async () => {
        if (failure === "CDP connection")
          await writeFile(
            join(profile, "DevToolsActivePort"),
            "9333\n/devtools/browser/original-id\n",
          );
      }),
      startupFailed: vi.fn(async () => {}),
      markEstablished: vi.fn(),
    };
    const reserve = vi.spyOn(SocialBrowserLaunch, "reserve").mockResolvedValue(capsule as never);
    const connect = vi.spyOn(Cdp, "connect").mockRejectedValue(new Error("CDP connection failed"));
    try {
      await expect(systemBrowserLauncher("browser")!(profile, true)).rejects.toThrow(
        failure === "missing endpoint" ? "did not expose" : "CDP connection failed",
      );
      expect(capsule.startupFailed).toHaveBeenCalledOnce();
      expect(capsule.start).toHaveBeenCalledOnce();
      expect(capsule.markEstablished).not.toHaveBeenCalled();
      expect(connect).toHaveBeenCalledTimes(failure === "CDP connection" ? 1 : 0);
    } finally {
      reserve.mockRestore();
      connect.mockRestore();
      await rm(profile, { recursive: true, force: true });
    }
  },
);

it.each([
  { background: true, visibility: "hidden" as const, hidden: true },
  { background: true, visibility: "visible" as const, hidden: false },
  { background: false, visibility: "hidden" as const, hidden: false },
])(
  "launches with desktop visibility $visibility (background $background)",
  async ({ background, visibility, hidden }) => {
    const profile = await mkdtemp(join(tmpdir(), "social-hidden-target-"));
    const capsule = {
      profile,
      exit: new Promise<void>(() => {}),
      failed: false,
      start: vi.fn(async (_executable: string, _args: string[]) => {
        await writeFile(
          join(profile, "DevToolsActivePort"),
          "9333\n/devtools/browser/original-id\n",
        );
      }),
      startupFailed: vi.fn(async () => {}),
      markEstablished: vi.fn(),
    };
    const send = vi.fn(async (method: string, _params?: Record<string, unknown>) => {
      if (method === "Target.getTargets")
        return { targetInfos: [{ targetId: "restored-page", type: "page" }] };
      if (method === "Target.createTarget") {
        return { targetId: "hidden-page" };
      }
      if (method === "Target.attachToTarget") return { sessionId: "own-session" };
      return {};
    });
    const cdp = {
      send,
      close: vi.fn(),
      on: vi.fn(),
      closed: new Promise<void>(() => {}),
    };
    const reserve = vi.spyOn(SocialBrowserLaunch, "reserve").mockResolvedValue(capsule as never);
    const connect = vi.spyOn(Cdp, "connect").mockResolvedValue(cdp as unknown as Cdp);
    try {
      const pending = systemBrowserLauncher("browser")!(profile, background, visibility);
      await pending;
      expect(send).toHaveBeenCalledWith("Target.attachToTarget", {
        targetId: "restored-page",
        flatten: true,
      });
      expect(capsule.markEstablished).toHaveBeenCalledOnce();
      const args = capsule.start.mock.calls[0][1];
      expect(args.includes("--headless=new")).toBe(hidden);
      expect(args.includes("about:blank")).toBe(true);
      if (hidden)
        expect(send).toHaveBeenCalledWith(
          "Emulation.setDeviceMetricsOverride",
          {
            width: 1100,
            height: 860,
            deviceScaleFactor: 1,
            mobile: false,
          },
          "own-session",
        );
      else
        expect(
          send.mock.calls.some(([method]) => method === "Emulation.setDeviceMetricsOverride"),
        ).toBe(false);
      expect(send.mock.calls.some(([method]) => method === "Target.createTarget")).toBe(false);
      expect(send.mock.calls.some(([method]) => method === "SystemInfo.getProcessInfo")).toBe(
        false,
      );
    } finally {
      reserve.mockRestore();
      connect.mockRestore();
      await rm(profile, { recursive: true, force: true });
    }
  },
);
