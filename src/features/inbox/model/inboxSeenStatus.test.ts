import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  mergeInboxSeenStorage,
  readInboxSeenStorage,
  seedInboxSeenStorage,
} from "./inboxSeenStorage";

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

it.each([false, true])(
  "skips a poll when the Inbox already has a seed (persisted: %s)",
  async (seeded) => {
    const postMessage = vi.fn();
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage = postMessage;
      },
    );
    vi.mocked(readInboxSeenStorage).mockResolvedValue({ ...snapshot(), seeded });
    const api = await import("./inboxSeen");
    const listener = vi.fn();
    const unsubscribe = api.subscribeInboxSeen(listener);
    try {
      await api.seedInboxSeenIfNeeded([entry]);
      const writes = seeded ? 0 : 1;
      expect(seedInboxSeenStorage).toHaveBeenCalledTimes(writes);
      expect(postMessage).toHaveBeenCalledTimes(writes);
      expect(api.inboxSeenIsSeeded()).toBe(true);
      const generation = api.inboxSeenGeneration();
      listener.mockClear();
      vi.mocked(readInboxSeenStorage).mockClear();

      await api.seedInboxSeenIfNeeded([entry]);

      expect(seedInboxSeenStorage).toHaveBeenCalledTimes(writes);
      expect(readInboxSeenStorage).not.toHaveBeenCalled();
      expect(postMessage).toHaveBeenCalledTimes(writes);
      expect(listener).not.toHaveBeenCalled();
      expect(api.inboxSeenGeneration()).toBe(generation);
    } finally {
      unsubscribe();
    }
  },
);

it("checks reconciled seed metadata before skipping a poll after a storage change", async () => {
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
    const poll = api.seedInboxSeenIfNeeded([entry]);
    expect(seedInboxSeenStorage).not.toHaveBeenCalled();

    finish({ ...snapshot(), seeded: false });
    await poll;

    expect(seedInboxSeenStorage).toHaveBeenCalledOnce();
    expect(api.inboxSeenIsSeeded()).toBe(true);
  } finally {
    unsubscribe();
  }
});

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

it("migrates the readable legacy records and skips a malformed one instead of failing", async () => {
  localStorage.setItem(
    "bycoda.inboxSeen",
    JSON.stringify({ seeded: true, items: { good: 5, bad: "oops" } }),
  );
  const api = await import("./inboxSeen");
  await api.readInboxEntryUnseen(entry);
  expect(api.inboxSeenStatus().state).toBe("ready");
  expect(mergeInboxSeenStorage).toHaveBeenCalledWith({ seeded: false, items: { good: 5 } });
});

it("keeps surfacing a real storage failure when marking an item seen", async () => {
  const api = await import("./inboxSeen");
  vi.mocked(mergeInboxSeenStorage).mockRejectedValueOnce(new Error("disk full"));
  const unrelated = api.markInboxItemSeen(entry);
  await expect(unrelated).resolves.toBe(false);
  expect(api.inboxSeenStatus()).toEqual({ state: "error", error: "disk full" });
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

it("stops an obsolete aggregate before reading the next page", async () => {
  const api = await import("./inboxSeen");
  await api.readInboxEntryUnseen(entry);
  const items = Array.from({ length: 1024 }, (_, index) => ({ ...entry, key: String(index) }));
  let finish!: () => void;
  vi.mocked(readInboxSeenStorage)
    .mockClear()
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = () =>
          resolve({
            seeded: true,
            items: new Map(items.map((item) => [item.key, Date.parse(item.updatedAt)])),
          });
      }),
    );
  const unsubscribe = api.subscribeInboxSeen(() => {});
  try {
    api.inboxHasUnseenItems(items);
    await vi.waitFor(() => expect(readInboxSeenStorage).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event("focus"));
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(readInboxSeenStorage).toHaveBeenCalledTimes(1);
  } finally {
    unsubscribe();
  }
});

it("ignores an obsolete aggregate failure after focus invalidation", async () => {
  const api = await import("./inboxSeen");
  await api.readInboxEntryUnseen(entry);
  let fail!: (error: Error) => void;
  vi.mocked(readInboxSeenStorage)
    .mockClear()
    .mockReturnValueOnce(
      new Promise((_, reject) => {
        fail = reject;
      }),
    );
  const unsubscribe = api.subscribeInboxSeen(() => {});
  try {
    api.inboxHasUnseenItems([entry]);
    await vi.waitFor(() => expect(readInboxSeenStorage).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event("focus"));
    api.inboxHasUnseenItems([entry]);
    await vi.waitFor(() => expect(api.inboxHasUnseenItems([entry])).toBe(true));
    fail(new Error("obsolete page"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.inboxSeenStatus().state).toBe("ready");
    expect(api.inboxHasUnseenItems([entry])).toBe(true);
  } finally {
    unsubscribe();
  }
});
