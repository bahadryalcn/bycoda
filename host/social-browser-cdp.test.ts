import { afterEach, expect, it, vi } from "vitest";
import { Cdp, cdpPage } from "./social-browser";

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
  await expect(page.cookies(["https://www.instagram.com"])).resolves.toEqual([
    { name: "ds_user_id", value: "123" },
  ]);
  const capture = page.watchResponse(/anything/);
  capture.stop();
  await expect(capture.body(1000)).resolves.toBeUndefined();
});
