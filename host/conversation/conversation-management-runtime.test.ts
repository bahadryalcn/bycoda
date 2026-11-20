import { afterEach, expect, it, vi } from "vitest";
import {
  ConversationManagementRuntime,
  runtimeStatusProjection,
} from "./conversation-management-runtime";
import type { RuntimeLogSubjectPrincipal } from "../execution/runtime-log-tools";
const principal = {
  kind: "assistant-thread",
  threadId: "thread",
  projectId: "p",
  environmentId: "env",
} as RuntimeLogSubjectPrincipal;
afterEach(() => vi.useRealTimers());
it("reads only finite Host metadata from a real projectless Room principal", async () => {
  const read = vi.fn(async (_action: string, _input: unknown, source: unknown) => {
    expect(source).toEqual({ kind: "assistant-thread", threadId: "global", environmentId: "host" });
    return { environmentId: "host", secret: "not disclosed" };
  });
  const snapshot = vi.fn(async () => []);
  const runtime = new ConversationManagementRuntime({
    read,
    revision: async () => "rev-0",
    snapshot,
    subscribe: () => () => {},
  });
  const room = { kind: "assistant-thread" as const, threadId: "global", environmentId: "host" };
  expect(await runtime.call("environment.describe", {}, room, async () => true)).toEqual({
    environmentId: "host",
  });
  await expect(runtime.call("events.subscribe", {}, room, async () => true)).rejects.toThrow(
    "explicit project",
  );
  await expect(runtime.call("tunnels.status", {}, room, async () => true)).rejects.toThrow(
    "explicit project",
  );
  await expect(
    runtime.call("tunnels.status", {}, { ...room, projectId: undefined }, async () => true),
  ).rejects.toThrow("explicit project");
  await expect(runtime.call("environment.describe", {}, room, async () => false)).rejects.toThrow(
    "revoked",
  );
  expect(read).toHaveBeenCalledOnce();
  expect(snapshot).not.toHaveBeenCalled();
});
function fixture() {
  let rows: unknown[] = [{ kind: "task", id: "one", status: "running" }];
  let revision = "rev-0";
  const listeners = new Set<() => void>();
  const read = vi.fn(async () => ({}));
  const revisionPort = vi.fn(async (projectId: string) => {
    expect(projectId).toBe("p");
    return revision;
  });
  const snapshot = vi.fn(async (projectId: string) => {
    expect(projectId).toBe("p");
    return rows;
  });
  const authorized = vi.fn(async () => true);
  const service = new ConversationManagementRuntime({
    read,
    revision: revisionPort,
    snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
  const call = (input: Record<string, unknown> = {}) =>
    service.call("events.subscribe", input, principal, authorized) as Promise<{
      cursor: string;
      heartbeat: boolean;
      items: unknown[];
      total: number;
      truncated: boolean;
    }>;
  return {
    call,
    authorized,
    listeners,
    snapshot,
    revisionPort,
    set rows(value: unknown[]) {
      rows = value;
    },
    /** Rows changed and the project revision moved, as a committed store write does. */
    commit(value: unknown[]) {
      rows = value;
      revision = `rev-${Number(revision.slice(4)) + 1}`;
    },
    /** Rows changed without the project revision moving: no list-visible change. */
    setRowsWithoutRevision(value: unknown[]) {
      rows = value;
    },
    changed: () => listeners.forEach((listener) => listener()),
  };
}
it("subscribes to committed changes, returns project metadata and releases its observer", async () => {
  const f = fixture();
  const initial = await f.call();
  expect(f.listeners.size).toBe(0);
  const pending = f.call({ cursor: initial.cursor });
  await vi.waitFor(() => expect(f.listeners.size).toBe(1));
  f.commit([{ kind: "task", id: "one", status: "done" }]);
  f.changed();
  const result = await pending;
  expect(result.cursor).not.toBe(initial.cursor);
  expect(result.items).toEqual([{ kind: "task", id: "one", status: "done" }]);
  expect(f.listeners.size).toBe(0);
});

it("keeps waiting on a store change that leaves the project revision unchanged, without building rows", async () => {
  const f = fixture();
  const initial = await f.call();
  const snapshotsBefore = f.snapshot.mock.calls.length;
  const pending = f.call({ cursor: initial.cursor, waitMs: 20_000 });
  await vi.waitFor(() => expect(f.listeners.size).toBe(1));
  f.changed();
  f.changed();
  await vi.waitFor(() => expect(f.revisionPort.mock.calls.length).toBeGreaterThan(2));
  expect(f.snapshot.mock.calls.length).toBe(snapshotsBefore);
  f.commit([{ kind: "task", id: "one", status: "done" }]);
  f.changed();
  expect((await pending).cursor).not.toBe(initial.cursor);
  expect(f.snapshot.mock.calls.length).toBe(snapshotsBefore + 1);
});

it("derives the cursor from the project revision, so rows beyond the visible window cannot change it silently", async () => {
  const f = fixture();
  const rows = Array.from({ length: 150 }, (_, index) => ({ kind: "session", id: `s${index}` }));
  f.rows = rows;
  const initial = await f.call();
  expect(initial.items).toHaveLength(100);
  // Row 120 changes but the project revision does not move: not a list-visible change.
  f.setRowsWithoutRevision(
    rows.map((row, index) => (index === 120 ? { ...row, status: "x" } : row)),
  );
  const pending = f.call({ cursor: initial.cursor, waitMs: 100 });
  await vi.waitFor(() => expect(f.listeners.size).toBe(1));
  f.changed();
  expect(await pending).toMatchObject({ heartbeat: true, cursor: initial.cursor });
});

it("wakes on a revision change even when the change lies beyond the first 100 rows", async () => {
  const f = fixture();
  const rows = Array.from({ length: 150 }, (_, index) => ({ kind: "session", id: `s${index}` }));
  f.rows = rows;
  const initial = await f.call();
  const pending = f.call({ cursor: initial.cursor });
  await vi.waitFor(() => expect(f.listeners.size).toBe(1));
  f.commit(rows.map((row, index) => (index === 120 ? { ...row, status: "x" } : row)));
  f.changed();
  const result = await pending;
  expect(result.cursor).not.toBe(initial.cursor);
  expect(result.items).toHaveLength(100);
  expect(result.total).toBe(150);
  expect(result.truncated).toBe(true);
});
it("returns a bounded heartbeat without fabricating a new event", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const initial = await f.call();
  const pending = f.call({ cursor: initial.cursor, waitMs: 100 });
  await vi.advanceTimersByTimeAsync(101);
  expect(await pending).toMatchObject({ heartbeat: true, cursor: initial.cursor });
  expect(f.listeners.size).toBe(0);
});
it("revocation during a wait prevents snapshot disclosure and removes listener", async () => {
  const f = fixture();
  const initial = await f.call();
  const pending = f.call({ cursor: initial.cursor });
  const rejection = expect(pending).rejects.toThrow("revoked");
  await vi.waitFor(() => expect(f.listeners.size).toBe(1));
  f.authorized.mockResolvedValue(false);
  f.changed();
  await rejection;
  expect(f.listeners.size).toBe(0);
});
it("does not lose the heartbeat if its timer fires during a slow snapshot", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const initial = await f.call();
  let release!: (value: unknown[]) => void;
  f.snapshot.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = f.call({ cursor: initial.cursor, waitMs: 100 });
  await vi.advanceTimersByTimeAsync(101);
  release(initial.items);
  expect(await pending).toMatchObject({ heartbeat: true });
  expect(f.listeners.size).toBe(0);
});
it("strips mobile access secrets and limits tunnel disclosure", () => {
  expect(
    runtimeStatusProjection("mobile.access.status", {
      state: "ready",
      mode: "lan",
      lanKey: "secret",
      tls: { key: "private" },
      approvalUrl: "sensitive",
    }),
  ).toEqual({ state: "ready", mode: "lan" });
  const status = runtimeStatusProjection(
    "tunnels.status",
    {
      tunnels: [
        { id: "one", state: "ready", publicUrl: "private-url", key: "secret" },
        { id: "two" },
      ],
    },
    { limit: 1 },
  );
  expect(status).toMatchObject({ items: [{ id: "one", state: "ready" }], total: 2, nextOffset: 1 });
  expect(JSON.stringify(status)).not.toContain("secret");
  expect(
    runtimeStatusProjection("environment.describe", {
      environmentId: "e",
      mobileTls: "private",
      webControl: "private",
    }),
  ).toEqual({ environmentId: "e" });
});
