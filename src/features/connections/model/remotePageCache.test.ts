// @vitest-environment happy-dom
import { expect, it } from "vitest";
import {
  REMOTE_PAGE_CACHE_MAX_BYTES,
  REMOTE_PAGE_CACHE_MAX_ENTRIES,
  REMOTE_PAGE_CACHE_SCHEMA,
  REMOTE_PAGE_CACHE_TTL_MS,
  parseRemotePageCacheRecord,
  planRemotePageCacheWrites,
  readRemotePageCache,
  sanitizeRemotePageSnapshot,
  writeRemotePageCache,
  type RemotePageCacheRecord,
  type RemotePageSnapshot,
} from "./remotePageCache";

const key = { environmentId: "machine-a", sessionId: "session-1" };
const snapshot: RemotePageSnapshot = {
  projectId: "project",
  revision: 5,
  updatedAt: 100,
  status: "idle",
  history: { revision: 5, totalBlocks: 10, before: 2 },
  session: {
    id: key.sessionId,
    cwd: "/repo",
    title: "Demo",
    model: "model",
    harness: "codex",
    runtimeMode: "supervised",
    modelSettings: {},
    blocks: [{ id: "b1", role: "assistant", text: "tail" }],
  },
};
const record = (index: number, bytes = 100, savedAt = index): RemotePageCacheRecord => ({
  schema: REMOTE_PAGE_CACHE_SCHEMA,
  key: JSON.stringify(["env", `s${index}`]),
  savedAt,
  bytes,
  snapshot,
});

it("evicts the oldest page to obey both entry and aggregate byte bounds", () => {
  const byCount = planRemotePageCacheWrites(
    Array.from({ length: REMOTE_PAGE_CACHE_MAX_ENTRIES }, (_, index) => record(index)),
    record(99, 100, 99),
  );
  expect(byCount).toHaveLength(REMOTE_PAGE_CACHE_MAX_ENTRIES);
  expect(byCount.some((entry) => entry.key.endsWith('"s0"]'))).toBe(false);

  const byBytes = planRemotePageCacheWrites(
    [record(0, REMOTE_PAGE_CACHE_MAX_BYTES - 200, 1), record(1, 100, 2)],
    record(2, 150, 3),
  );
  expect(byBytes.reduce((sum, entry) => sum + entry.bytes, 0)).toBeLessThanOrEqual(
    REMOTE_PAGE_CACHE_MAX_BYTES,
  );
  expect(byBytes.map((entry) => entry.key)).toEqual([record(1).key, record(2).key]);
});

it("fails closed for wrong schema, expired records, and owner-key mismatches", () => {
  const now = 50_000_000;
  const valid = {
    ...record(1, JSON.stringify(snapshot).length, now),
    key: JSON.stringify([key.environmentId, key.sessionId]),
    snapshot,
  };
  expect(parseRemotePageCacheRecord(valid, key, now)).toEqual(snapshot);
  expect(parseRemotePageCacheRecord({ ...valid, schema: 0 }, key, now)).toBeUndefined();
  expect(
    parseRemotePageCacheRecord({ ...valid, savedAt: now - REMOTE_PAGE_CACHE_TTL_MS - 1 }, key, now),
  ).toBeUndefined();
  expect(
    parseRemotePageCacheRecord(valid, { ...key, environmentId: "other" }, now),
  ).toBeUndefined();
  expect(
    parseRemotePageCacheRecord(
      {
        ...valid,
        snapshot: {
          ...snapshot,
          session: { ...snapshot.session, id: "other-session" },
        },
      },
      key,
      now,
    ),
  ).toBeUndefined();
});

it("stores only projected tail JSON and drops drafts, credentials, and attachment payloads", () => {
  const projected = sanitizeRemotePageSnapshot({
    ...snapshot,
    session: {
      ...snapshot.session,
      queuedMessages: [{ text: "must not persist" }],
      providerAccountId: "secret-account",
      blocks: [
        { ...snapshot.session.blocks[0], draft: true },
        {
          id: "b2",
          role: "assistant",
          text: "ok",
          providerAccountId: "hidden",
          tool: { output: "result", apiKey: "hidden" },
          attachments: [{ name: "image.png", data: "base64", path: "private", size: 3 }],
        },
      ],
    },
  });
  expect(projected?.session.blocks).toHaveLength(1);
  expect(projected?.session.blocks[0]).not.toHaveProperty("providerAccountId");
  expect(projected?.session.blocks[0].tool).toEqual({ output: "result" });
  expect(projected?.session.blocks[0].attachments).toEqual([{ name: "image.png", size: 3 }]);
  expect(projected?.session).not.toHaveProperty("queuedMessages");
  expect(projected?.session).not.toHaveProperty("providerAccountId");
});

it("silently skips storage when IndexedDB is unavailable", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: undefined,
  });
  try {
    await expect(writeRemotePageCache(key, snapshot)).resolves.toBeUndefined();
    await expect(readRemotePageCache(key)).resolves.toBeUndefined();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "indexedDB", descriptor);
    else delete (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  }
});

it("bounds cached pages to the last 100 blocks, advances the cursor, and accepts absent model settings", () => {
  const blocks = Array.from({ length: 105 }, (_, index) => ({
    id: `b${index}`,
    role: "assistant" as const,
    text: `block ${index}`,
  }));
  const projected = sanitizeRemotePageSnapshot({
    ...snapshot,
    history: { revision: 5, totalBlocks: 105 },
    session: { ...snapshot.session, modelSettings: undefined, blocks },
  });
  expect(projected?.session.blocks).toHaveLength(100);
  expect(projected?.session.blocks[0].id).toBe("b5");
  expect(projected?.history.before).toBe(5);
  expect(projected?.session.modelSettings).toEqual({});
  expect(
    sanitizeRemotePageSnapshot({
      ...snapshot,
      session: {
        ...snapshot.session,
        blocks: [
          {
            id: "huge",
            role: "tool",
            text: "x",
            tool: { output: "x".repeat(65 * 1024) },
          },
        ],
      },
    }),
  ).toBeUndefined();
});
