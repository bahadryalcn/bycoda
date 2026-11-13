import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readInboxSeenStorage } from "./inboxSeenStorage";

vi.mock("./inboxSeenStorage", () => ({
  readInboxSeenStorage: vi.fn(),
  mergeInboxSeenStorage: vi.fn(),
  seedInboxSeenStorage: vi.fn(),
}));

const entry = { key: "jira:APP-1", updatedAt: new Date().toISOString() };
const snapshot = () => ({
  seeded: true,
  items: new Map<string, number | undefined>([[entry.key, undefined]]),
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal("indexedDB", {});
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("window", new EventTarget());
  vi.mocked(readInboxSeenStorage).mockResolvedValue(snapshot());
});
afterEach(() => vi.unstubAllGlobals());

it.each(["entry", "aggregate"])(
  "keeps ready status and avoids start notifications during a background %s read",
  async (kind) => {
    const api = await import("./inboxSeen");
    await api.readInboxEntryUnseen({ ...entry, key: "initialize" });
    expect(api.inboxSeenStatus().state).toBe("ready");
    let finish!: (result: ReturnType<typeof snapshot>) => void;
    vi.mocked(readInboxSeenStorage).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    let notifications = 0;
    const unsubscribe = api.subscribeInboxSeen(() => {
      notifications++;
    });
    try {
      if (kind === "entry") api.isInboxEntryUnseen(entry);
      else api.inboxHasUnseenItems([entry]);
      await Promise.resolve();
      await Promise.resolve();
      expect(api.inboxSeenStatus().state).toBe("ready");
      expect(notifications).toBe(0);
      finish(snapshot());
      await vi.waitFor(() => expect(notifications).toBe(1));
      expect(api.inboxSeenStatus().state).toBe("ready");
      expect(
        kind === "entry" ? api.isInboxEntryUnseen(entry) : api.inboxHasUnseenItems([entry]),
      ).toBe(true);
    } finally {
      unsubscribe();
    }
  },
);

it("still exposes initialization, storage failure and explicit retry", async () => {
  const api = await import("./inboxSeen");
  vi.mocked(readInboxSeenStorage).mockRejectedValueOnce(new Error("storage unavailable"));
  const read = api.readInboxEntryUnseen(entry);
  expect(api.inboxSeenStatus().state).toBe("loading");
  await read;
  expect(api.inboxSeenStatus()).toEqual({ state: "error", error: "storage unavailable" });
  api.retryInboxSeenStorage();
  expect(api.inboxSeenStatus().state).toBe("loading");
  await vi.waitFor(() => expect(api.inboxSeenStatus().state).toBe("ready"));
});

it("keeps the initialized store ready while reconciling another window's history", async () => {
  const api = await import("./inboxSeen");
  await api.readInboxEntryUnseen(entry);
  let finish!: (result: ReturnType<typeof snapshot>) => void;
  vi.mocked(readInboxSeenStorage).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const unsubscribe = api.subscribeInboxSeen(() => {});
  try {
    const change = new Event("storage");
    Object.defineProperty(change, "key", { value: "bycoda.inboxSeen" });
    window.dispatchEvent(change);
    expect(api.inboxSeenStatus().state).toBe("ready");
    expect(readInboxSeenStorage).toHaveBeenCalledTimes(3);
    finish(snapshot());
    await Promise.resolve();
    await Promise.resolve();
    expect(api.inboxSeenStatus().state).toBe("ready");
  } finally {
    unsubscribe();
  }
});
