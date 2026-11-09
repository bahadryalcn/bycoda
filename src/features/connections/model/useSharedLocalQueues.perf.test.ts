// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../../sessions/model/session";
import type { SharedQueue } from "./sharedQueue";
import { useSharedLocalQueues, wakeSharedLocalQueues } from "./useSharedLocalQueues";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async () => [
    { id: "local", environmentId: "host", localHost: true, endpoint: "http://127.0.0.1:1" },
  ],
}));
vi.mock("./connections", () => ({
  cachedRemoteCapabilities: () => ["sessions.queue"],
  loadRemoteCapabilities: async () => ["sessions.queue"],
  remoteRequest: (...args: unknown[]) => mocks.request(...args),
}));
vi.mock("./remoteAttachments", () => ({
  uploadRemoteAttachments: async (_machine: string, attachments: unknown[]) => attachments,
}));

const IDLE_SESSIONS = 4;
let root: Root;
let sessionsRef: { current: Session[] };
let hidden = false;
/** Every pass of the dispatcher reads `document.hidden` once: a count of its wakeups. */
let hiddenReads = 0;
const reachable = { current: true };
const queue: SharedQueue = { messages: [], revision: 0 };

const setSessions = (update: (sessions: Session[]) => Session[]) => {
  sessionsRef.current = update(sessionsRef.current);
};
function Probe() {
  useSharedLocalQueues(sessionsRef, setSessions, reachable);
  return null;
}
const flush = async () => {
  for (let i = 0; i < 60; i++) await Promise.resolve();
};
async function advance(ms: number) {
  // Step in tick-sized slices so every interval callback and its awaits settle.
  for (let elapsed = 0; elapsed < ms; elapsed += 1500) {
    await act(async () => {
      vi.advanceTimersByTime(Math.min(1500, ms - elapsed));
      await flush();
    });
  }
}
const hostCalls = () => mocks.request.mock.calls.length;

beforeEach(() => {
  hidden = false;
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  hiddenReads = 0;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => {
    hiddenReads++;
    return hidden;
  });
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() =>
    hidden ? "hidden" : "visible",
  );
  mocks.request.mockReset();
  mocks.request.mockImplementation(async () => structuredClone(queue));
  // Finished historical chats: nothing queued, nothing running.
  sessionsRef = {
    current: Array.from(
      { length: IDLE_SESSIONS },
      (_, index) =>
        ({
          id: `idle-${index}`,
          cwd: "/repo",
          blocks: [{ id: `user-${index}`, role: "user", text: "done" }],
        }) as Session,
    ),
  };
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mountAndSettle() {
  await act(async () => {
    root.render(createElement(Probe));
  });
  await advance(15_000);
}

describe("shared local queue sync cost while idle", () => {
  // perf P4: idle sessions must not be re-read from the host every ~10 s.
  it("does not re-sync each idle session more than once per minute", async () => {
    await mountAndSettle();
    const before = hostCalls();
    await advance(55_000);
    // At most one background read per idle session in 55 s of nothing happening.
    expect(hostCalls() - before).toBeLessThanOrEqual(IDLE_SESSIONS);
  });

  // perf P4: pause host queue sync while document.hidden.
  it("makes no host requests for idle sessions while the document is hidden", async () => {
    await mountAndSettle();
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    await advance(1_500);
    const before = hostCalls();
    await advance(60_000);
    expect(hostCalls() - before).toBe(0);
  });

  // Step 8: no 1.5 s interval. The 0.6.70 dispatcher ran 36 passes in 55 s of nothing;
  // now only the one 60 s safety pass is left.
  it("wakes the dispatcher far less often than the old 1.5 s tick while nothing changes", async () => {
    await mountAndSettle();
    const before = hiddenReads;
    await advance(55_000);
    expect(hiddenReads - before).toBeLessThanOrEqual(36 / 12);
  });

  it("holds a single timer once every idle queue has been looked at", async () => {
    await mountAndSettle();
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
  });

  it("still delivers a woken queue while the document is hidden", async () => {
    await mountAndSettle();
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    await advance(1_500);
    const before = hostCalls();
    wakeSharedLocalQueues(["idle-1"]);
    await advance(1_500);
    expect(hostCalls() - before).toBeGreaterThanOrEqual(1);
  });

  it("stops issuing requests once unmounted", async () => {
    await mountAndSettle();
    act(() => root.unmount());
    const before = hostCalls();
    await advance(30_000);
    expect(hostCalls()).toBe(before);
    root = createRoot(document.createElement("div"));
  });
});
