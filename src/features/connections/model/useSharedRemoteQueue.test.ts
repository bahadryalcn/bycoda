// @vitest-environment happy-dom
import { act, createElement } from "react";
import { notifyRemoteRecovered } from "./remoteHealth";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mergeQueueChange, type SharedQueue } from "./sharedQueue";
import {
  REMOTE_QUEUE_SAFETY_MS,
  REMOTE_QUEUE_WAKE_MIN_MS,
  useSharedRemoteQueue,
} from "./useSharedRemoteQueue";

const mocks = vi.hoisted(() => ({ request: vi.fn(), setQueue: vi.fn(async () => {}) }));
vi.mock("./connections", () => ({
  cachedRemoteCapabilities: () => ["sessions.queue"],
  remoteRequest: (...args: unknown[]) => mocks.request(...args),
}));
vi.mock("../../sessions/data/sessionStore", () => ({
  loadStoredQueue: async () => [],
  setSessionQueue: (...args: unknown[]) =>
    (mocks.setQueue as (...a: unknown[]) => unknown)(...args),
}));
let root: Root;
let current: ReturnType<typeof useSharedRemoteQueue>;
let saved: SharedQueue;
let wakeToken: unknown = 0;
function Probe() {
  current = useSharedRemoteQueue("chat", "machine", "host", true, wakeToken);
  return null;
}
beforeEach(async () => {
  wakeToken = 0;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  saved = { messages: [{ id: "a", text: "task", attachments: [] }], status: "paused", revision: 1 };
  mocks.request.mockReset().mockImplementation(async (_machine, method, params) => {
    if (method.endsWith(".change"))
      saved = {
        ...mergeQueueChange(saved, {
          before: params.before,
          after: params.after,
        }),
        ...(params.takeOwnership ? { consumer: params.clientId } : {}),
        revision: saved.revision + 1,
      };
    return structuredClone(saved);
  });
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Probe)));
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(["timer", "online", "recovered"])(
  "recovers an initial queue-load failure on %s without sending or resuming it",
  async (event) => {
    await act(async () => root.unmount());
    vi.useFakeTimers();
    mocks.request.mockRejectedValueOnce(new Error("Machine is unreachable"));
    root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Probe)));
    expect(current.loaded).toBe(false);
    expect(current.error).toContain("unreachable");
    mocks.request.mockClear();
    await act(async () => {
      if (event === "timer") await vi.advanceTimersByTimeAsync(6_000);
      else if (event === "online") window.dispatchEvent(new Event("online"));
      else notifyRemoteRecovered("host");
    });
    expect(current.loaded).toBe(true);
    expect(current.error).toBeUndefined();
    expect(saved.status).toBe("paused");
    expect(saved.messages).toHaveLength(1);
    expect(mocks.request.mock.calls.every((call) => call[1] === "sessions.queue.get")).toBe(true);
  },
);

it("waits for durable ownership before confirming Resume", async () => {
  await act(async () => {
    expect(await current.release()).toBe(true);
  });
  expect(saved.status).toBe("active");
  expect(current.canDrain).toBe(true);
  expect(saved.messages).toHaveLength(1);
});

it("retries a synchronization error and prepares the selected row on the same action", async () => {
  mocks.request.mockRejectedValueOnce(new Error("offline"));
  await act(async () => {
    await expect(current.release()).rejects.toThrow("offline");
  });
  await act(async () => {
    expect(await current.prepareSend(true)).toBe(true);
  });
  expect(current.error).toBeUndefined();
  expect(saved.messages).toHaveLength(1);
});

it("does not release the queue when Stop happens during synchronization", async () => {
  let valid = true;
  const request = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementationOnce(async (...args) => {
    valid = false;
    return request(...args);
  });
  await act(async () => {
    await expect(current.release(() => valid)).rejects.toThrow("cancelled");
  });
  expect(saved.status).toBe("paused");
  expect(saved.messages).toHaveLength(1);
});

it("restores a pause when Stop arrives after ownership was written", async () => {
  let valid = true;
  const request = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (...args) => {
    const result = await request(...args);
    if (saved.status === "active") valid = false;
    return result;
  });
  await act(async () => {
    await expect(current.release(() => valid)).rejects.toThrow("cancelled");
  });
  expect(saved.status).toBe("paused");
  expect(saved.messages).toHaveLength(1);
});

describe("reading the queue", () => {
  const reads = () =>
    mocks.request.mock.calls.filter((call) => String(call[1]).endsWith(".get")).length;
  async function remount() {
    await act(async () => root.unmount());
    vi.useFakeTimers();
    mocks.request.mockClear();
    root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Probe)));
    expect(current.loaded).toBe(true);
    mocks.request.mockClear();
  }
  const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

  it("does not poll the host every second and a half", async () => {
    await remount();
    await advance(REMOTE_QUEUE_SAFETY_MS - 1_000);
    expect(reads()).toBe(0);
  });

  it("keeps one slow safety read while the window is visible", async () => {
    await remount();
    await advance(REMOTE_QUEUE_SAFETY_MS + 500);
    expect(reads()).toBe(1);
  });

  it("reads at once when the host reports the session moved", async () => {
    await remount();
    wakeToken = "revision 8";
    await act(async () => root.render(createElement(Probe)));
    expect(reads()).toBe(1);
  });

  it("reads at most once per throttle window while the session moves at streaming rate", async () => {
    await remount();
    for (let flush = 1; flush <= 40; flush++) {
      wakeToken = `revision ${flush}`;
      await act(async () => root.render(createElement(Probe)));
      await advance(120);
    }
    // 4.8 s of streaming: the first move reads at once, one more read closes the window.
    expect(reads()).toBeLessThanOrEqual(2);
    await advance(REMOTE_QUEUE_WAKE_MIN_MS);
    expect(reads()).toBeLessThanOrEqual(3);
  });

  it("does not write the native copy again when a read brings the same rows", async () => {
    await remount();
    mocks.setQueue.mockClear();
    for (let i = 1; i <= 3; i++) {
      wakeToken = `status ${i}`;
      await act(async () => root.render(createElement(Probe)));
      await advance(REMOTE_QUEUE_WAKE_MIN_MS + 100);
    }
    expect(reads()).toBeGreaterThanOrEqual(3);
    expect(mocks.setQueue).not.toHaveBeenCalled();
  });

  it("reads nothing while hidden and catches up when shown again", async () => {
    await remount();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    try {
      await advance(REMOTE_QUEUE_SAFETY_MS * 4);
      expect(reads()).toBe(0);
      hidden.mockReturnValue(false);
      await act(async () => document.dispatchEvent(new Event("visibilitychange")));
      expect(reads()).toBe(1);
    } finally {
      hidden.mockRestore();
    }
  });
});

describe("keeping a follow-up the host did not take", () => {
  const draft = { id: "late", text: "do this too", attachments: [] };
  async function claimInFlight() {
    saved = {
      ...saved,
      revision: saved.revision + 1,
      claim: { id: "a", clientId: "desktop:win", token: "t" },
    };
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
  }

  it("waits for a claim in flight and then stores the message, paused when asked", async () => {
    vi.useFakeTimers();
    await claimInFlight();
    expect(current.queue.claim).toBeDefined();
    let kept: boolean | undefined;
    await act(async () => {
      void current.keep(draft, true).then((value) => (kept = value));
    });
    expect(kept).toBeUndefined();
    // The desktop finishes its send; the next attempt finds the queue free.
    saved = { ...saved, revision: saved.revision + 1, claim: undefined };
    await act(async () => void (await vi.advanceTimersByTimeAsync(5_000)));
    expect(kept).toBe(true);
    expect(saved.messages.map((row) => row.id)).toEqual(["a", "late"]);
    expect(saved.status).toBe("paused");
  });

  it("says so when the queue never takes it, instead of dropping it silently", async () => {
    vi.useFakeTimers();
    await claimInFlight();
    let kept: boolean | undefined;
    await act(async () => {
      void current.keep(draft, false).then((value) => (kept = value));
    });
    await act(async () => void (await vi.advanceTimersByTimeAsync(60_000)));
    expect(kept).toBe(false);
    expect(saved.messages.map((row) => row.id)).toEqual(["a"]);
  });

  it("does not add the same row twice", async () => {
    await act(async () => {
      expect(await current.keep({ id: "a", text: "task", attachments: [] }, false)).toBe(true);
    });
    expect(saved.messages.map((row) => row.id)).toEqual(["a"]);
  });
});

describe("settling an unconfirmed delivery from this computer", () => {
  const unknown = {
    id: "a",
    text: "task",
    attachments: [],
    deliveryUnknown: true as const,
  };
  beforeEach(async () => {
    saved = {
      messages: [unknown, { id: "b", text: "next", attachments: [] }],
      status: "paused",
      revision: 2,
    };
    await act(async () => current.retry());
  });
  const settle = (outcome: Parameters<typeof current.resolveDelivery>[1]) =>
    act(async () => current.resolveDelivery("a", outcome));

  it.each([
    ["delivered", ["b"], "paused"],
    ["discard", ["b"], "paused"],
  ] as const)("%s takes the row out and holds the rest", async (outcome, ids, status) => {
    await settle(outcome);
    expect(saved.messages.map((row) => row.id)).toEqual(ids);
    expect(saved.status).toBe(status);
  });

  it("send again clears the doubt and lets the queue drain", async () => {
    await settle("retry");
    expect(saved.messages.map((row) => row.id)).toEqual(["a", "b"]);
    expect(saved.messages[0].deliveryUnknown).toBeUndefined();
    expect(saved.status).toBe("active");
  });

  it("keep clears the doubt and pauses the queue", async () => {
    await settle("keep");
    expect(saved.messages[0].deliveryUnknown).toBeUndefined();
    expect(saved.status).toBe("paused");
  });
});
