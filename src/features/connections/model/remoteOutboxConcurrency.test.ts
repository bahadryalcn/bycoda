// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import type { HostCommand } from "./protocol";
import { admitDurableRemoteCommand, readDurableRemoteCommand } from "./remoteOutbox";

// In-memory stand-in for the durable outbox: one global revision, page cursors and a
// compare-and-set that fails when the expected bytes or the revision moved.
const store = vi.hoisted(() => ({
  entries: new Map<string, string>(),
  revision: 0,
  /** Runs once, before the next compare-and-set, as if another window wrote in between. */
  beforeChange: undefined as undefined | (() => void),
  /** Runs once, before the page after the first one, as if a write landed mid-scan. */
  beforePage: undefined as undefined | (() => void),
}));

vi.mock("./remoteOutboxDatabase", async (original) => {
  const actual = await original<typeof import("./remoteOutboxDatabase")>();
  return {
    ...actual,
    readOutboxDatabasePage: async (
      kind: "entries" | "settlements",
      prefix: string,
      after?: string,
    ) => {
      if (kind !== "entries") return { values: [], revision: store.revision };
      if (after !== undefined) {
        const hook = store.beforePage;
        store.beforePage = undefined;
        hook?.();
      }
      const keys = [...store.entries.keys()]
        .filter((key) => key.startsWith(prefix) && (after === undefined || key > after))
        .sort();
      const [first] = keys;
      return {
        values: first === undefined ? [] : [{ key: first, raw: store.entries.get(first)! }],
        revision: store.revision,
        ...(keys.length > 1 && first !== undefined ? { next: first } : {}),
      };
    },
    readOutboxDatabaseRecord: async (key: string) => ({
      entry: store.entries.get(key),
      settlement: undefined,
      resolved: false,
      revision: store.revision,
    }),
    readOutboxLegacyPage: async () => ({ values: [], revision: store.revision }),
    readOutboxLegacyValue: async () => null,
    changeOutboxDatabase: async (
      key: string,
      expected: string | null,
      next: string | null,
      _settledLegacyRaw?: string,
      expectedRevision?: number,
    ) => {
      const hook = store.beforeChange;
      store.beforeChange = undefined;
      hook?.();
      const current = store.entries.get(key) ?? null;
      if (
        current !== expected ||
        (expectedRevision !== undefined && expectedRevision !== store.revision)
      )
        throw new actual.OutboxConflictError("The pending request changed.");
      if (next === null) store.entries.delete(key);
      else store.entries.set(key, next);
      store.revision++;
    },
  };
});

const prefix = 'bycoda.remote-command.v1:["project","env"]:';
const keyOf = (commandId: string) => `${prefix}${commandId}`;
const send = (commandId: string, sessionId = "session-a"): HostCommand => ({
  type: "send",
  commandId,
  sessionId,
  text: `hello ${commandId}`,
});
const savedAt = Date.now() - 60_000;
const raw = (command: HostCommand, at = savedAt) => JSON.stringify({ v: 1, savedAt: at, command });

let wait: ReturnType<typeof vi.fn>;
/** Deterministic jitter: the shortest delay in each window. */
const retry = () => ({ wait, random: () => 0 });

beforeEach(() => {
  store.entries.clear();
  store.revision = 0;
  store.beforeChange = undefined;
  store.beforePage = undefined;
  wait = vi.fn(async () => {});
});

it("retries a concurrent unrelated write and the send is still admitted", async () => {
  const command = send("first");
  store.beforeChange = () => {
    store.entries.set(keyOf("elsewhere"), raw(send("elsewhere", "session-b")));
    store.revision++;
  };

  await expect(
    admitDurableRemoteCommand("project", "env", command, undefined, undefined, retry()),
  ).resolves.toBeUndefined();

  expect(JSON.parse(store.entries.get(keyOf("first"))!).command).toEqual(command);
  expect(store.entries.has(keyOf("elsewhere"))).toBe(true);
  expect(wait).toHaveBeenCalledTimes(1);
});

it("re-reads a scan that another writer changed between pages", async () => {
  store.entries.set(keyOf("alpha"), raw(send("alpha", "session-a")));
  store.entries.set(keyOf("zeta"), raw(send("zeta", "session-b")));
  store.revision = 1;
  store.beforePage = () => {
    store.entries.set(keyOf("middle"), raw(send("middle", "session-c")));
    store.revision++;
  };

  const observed = await readDurableRemoteCommand(
    "project",
    "env",
    "session-a",
    undefined,
    retry(),
  );

  expect(observed.command?.commandId).toBe("alpha");
  expect(wait).toHaveBeenCalledTimes(1);
});

it("does not duplicate a request that another window admitted identically", async () => {
  const command = send("twice");
  store.beforeChange = () => {
    store.entries.set(keyOf("twice"), raw(command, savedAt + 1));
    store.revision++;
  };

  await admitDurableRemoteCommand("project", "env", command, undefined, undefined, retry());

  expect(store.entries.size).toBe(1);
  expect(JSON.parse(store.entries.get(keyOf("twice"))!).savedAt).toBe(savedAt + 1);
  expect(wait).toHaveBeenCalledTimes(1);
});

it("still errors when the same request was changed by another writer", async () => {
  const other = { ...send("contested"), text: "a different prompt" };
  store.beforeChange = () => {
    store.entries.set(keyOf("contested"), raw(other));
    store.revision++;
  };

  await expect(
    admitDurableRemoteCommand("project", "env", send("contested"), undefined, undefined, retry()),
  ).rejects.toThrow("The pending request changed. Recover the original request");

  // One retry after the lost compare-and-set, then the re-read refuses without another wait.
  expect(wait).toHaveBeenCalledTimes(1);
  expect(JSON.parse(store.entries.get(keyOf("contested"))!).command).toEqual(other);
});

it("still errors when another request for the same session appears", async () => {
  store.beforeChange = () => {
    store.entries.set(keyOf("rival"), raw(send("rival", "session-a")));
    store.revision++;
  };

  await expect(
    admitDurableRemoteCommand(
      "project",
      "env",
      send("mine", "session-a"),
      undefined,
      undefined,
      retry(),
    ),
  ).rejects.toThrow("The pending request changed. Recover the original request");

  expect(store.entries.has(keyOf("mine"))).toBe(false);
});

it("gives up after five attempts with a bounded backoff", async () => {
  const noisy = () => {
    const commandId = `noise-${store.revision}`;
    store.entries.set(keyOf(commandId), raw(send(commandId, "session-b")));
    store.revision++;
    store.beforeChange = noisy;
  };
  store.beforeChange = noisy;

  await expect(
    admitDurableRemoteCommand("project", "env", send("starved"), undefined, undefined, retry()),
  ).rejects.toThrow("The pending request changed.");

  expect(wait.mock.calls.map(([ms]) => ms)).toEqual([10, 20, 40, 80]);
  expect(store.entries.has(keyOf("starved"))).toBe(false);
});
