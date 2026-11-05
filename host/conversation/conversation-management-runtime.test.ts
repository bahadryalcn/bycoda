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
  const runtime = new ConversationManagementRuntime({ read, snapshot, subscribe: () => () => {} });
  const room = { kind: "assistant-thread" as const, threadId: "global", environmentId: "host" };
  expect(await runtime.call("environment.describe", {}, room, async () => true)).toEqual({ environmentId: "host" });
  await expect(runtime.call("events.subscribe", {}, room, async () => true)).rejects.toThrow("explicit project");
  await expect(runtime.call("tunnels.status", {}, room, async () => true)).rejects.toThrow("explicit project");
  await expect(runtime.call("tunnels.status", {}, { ...room, projectId: undefined }, async () => true)).rejects.toThrow("explicit project");
  await expect(runtime.call("environment.describe", {}, room, async () => false)).rejects.toThrow("revoked");
  expect(read).toHaveBeenCalledOnce();
  expect(snapshot).not.toHaveBeenCalled();
});
function fixture() {
  let rows: unknown[] = [{ kind: "task", id: "one", status: "running" }];
  const listeners = new Set<() => void>();
  const read = vi.fn(async () => ({}));
  const snapshot = vi.fn(async (projectId: string) => {
    expect(projectId).toBe("p");
    return rows;
  });
  const authorized = vi.fn(async () => true);
  const service = new ConversationManagementRuntime({
    read,
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
    }>;
  return {
    call,
    authorized,
    listeners,
    snapshot,
    set rows(value: unknown[]) {
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
  f.rows = [{ kind: "task", id: "one", status: "done" }];
  f.changed();
  const result = await pending;
  expect(result.cursor).not.toBe(initial.cursor);
  expect(result.items).toEqual([{ kind: "task", id: "one", status: "done" }]);
  expect(f.listeners.size).toBe(0);
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
