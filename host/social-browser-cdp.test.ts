import { afterEach, expect, it, vi } from "vitest";
import { Cdp } from "./social-browser";

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
