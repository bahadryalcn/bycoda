import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CYCLE_INTERVAL_MS,
  MAX_PARALLEL_SYNCS,
  MIN_CYCLE_SPACING_MS,
  SYNC_BACKOFF_BASE_MS,
  SYNC_BACKOFF_MAX_MS,
  SYNC_UNSUPPORTED_MESSAGE,
  getSyncStatus,
  recordSyncStatus,
  runSyncCycle,
  startSyncLoop,
  subscribeSyncMerged,
  subscribeSyncStatus,
  syncBackoffMs,
  syncNow,
} from "./syncClient";
import { loadPeerState, peerRev, queueLocalChange } from "./syncPeerState";
import { loadProjectGroups, saveProjectGroups } from "../../projects/model/projectGroups";
import type { SyncRecord } from "./syncProtocol";

function mockLocalStorage() {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
    configurable: true,
  });
}

const MACHINE = "host-1";

describe("runSyncCycle", () => {
  beforeEach(mockLocalStorage);
  it.each([70_000, 1_100_000])(
    "pulls changes on repeated retries with an invalid %i-byte local group",
    async (size) => {
      let revision = 3;
      const records: SyncRecord[] = [
        { table: "group", id: "large", rev: 1, value: { id: "large", name: "Original" } },
        { table: "group", id: "edited", rev: 2, value: { id: "edited", name: "Before" } },
        { table: "group", id: "deleted", rev: 3, value: { id: "deleted", name: "Delete me" } },
      ];
      const request = vi.fn(async (method: string, params: any) => {
        if (method === "sync.pull")
          return {
            rev: revision,
            records: records.filter((record) => record.rev > params.sinceRev),
          };
        const applied = [];
        const invalid = [];
        for (const op of params.ops) {
          if (op.id === "large" && op.value?.name.length > 64 * 1024)
            invalid.push({ table: op.table, id: op.id, error: "too large" });
          else applied.push({ table: op.table, id: op.id, rev: ++revision });
        }
        return { rev: revision, applied, invalid, rejected: [] };
      });
      await runSyncCycle(MACHINE, request);
      const name = "x".repeat(size);
      saveProjectGroups(
        loadProjectGroups().map((group) => (group.id === "large" ? { ...group, name } : group)),
      );
      const log = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        for (const cycle of [1, 2]) {
          records.push({
            table: "group",
            id: "edited",
            rev: ++revision,
            value: { id: "edited", name: `Remote ${cycle}` },
          });
          records.push({
            table: "group",
            id: "large",
            rev: ++revision,
            value: { id: "large", name: "Must not overwrite pending" },
          });
          if (cycle === 1)
            records.push({ table: "group", id: "deleted", rev: ++revision, value: null });
          request.mockClear();
          await expect(runSyncCycle(MACHINE, request)).rejects.toThrow("remain pending");
          expect(request.mock.calls.filter(([method]) => method === "sync.pull")).toHaveLength(1);
          const groups = loadProjectGroups();
          expect(groups.find((group) => group.id === "edited")?.name).toBe(`Remote ${cycle}`);
          expect(groups.some((group) => group.id === "deleted")).toBe(false);
          expect(groups.find((group) => group.id === "large")?.name).toBe(name);
          expect(
            loadPeerState(MACHINE).outbox.find((op) => op.id === "large")?.value,
          ).toMatchObject({ name });
          expect(getSyncStatus(MACHINE).state).toBe("error");
        }
      } finally {
        log.mockRestore();
      }
    },
  );
  it("keeps host group order when its referenced groups arrive on later pages", async () => {
    let revision = 3;
    const request = async (method: string, params: any) => {
      if (method === "sync.push")
        return {
          rev: revision,
          rejected: [],
          applied: params.ops.map((op: any) => ({
            table: op.table,
            id: op.id,
            rev: ++revision,
          })),
        };
      if (params.sinceRev === 0)
        return {
          rev: 2,
          more: true,
          untilRev: 3,
          records: [
            {
              table: "groupOrder",
              id: "groups",
              rev: 1,
              value: { order: ["b", "a"] },
            },
            { table: "group", id: "a", rev: 2, value: { id: "a", name: "A" } },
          ],
        };
      if (params.sinceRev === 2)
        return {
          rev: 3,
          more: false,
          untilRev: 3,
          records: [{ table: "group", id: "b", rev: 3, value: { id: "b", name: "B" } }],
        };
      return { rev: revision, records: [] };
    };
    await runSyncCycle(MACHINE, request);
    expect(loadProjectGroups().map((group) => group.id)).toEqual(["b", "a"]);
  });

  it("stops paging with a visible error when the checkpoint cannot be saved", async () => {
    const storage = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const request = vi.fn(async () => ({
      rev: 1,
      more: true,
      untilRev: 2,
      records: [],
    }));
    try {
      await expect(runSyncCycle(MACHINE, request)).rejects.toThrow("progress could not be saved");
      expect(request).toHaveBeenCalledTimes(1);
      expect(peerRev(MACHINE)).toBe(0);
      expect(getSyncStatus(MACHINE).state).toBe("error");
    } finally {
      storage.mockRestore();
      log.mockRestore();
    }
  });
  it("splits a large UTF-8 outbox into bounded requests without dropping its records", async () => {
    for (let i = 0; i < 100; i++)
      queueLocalChange(MACHINE, "group", `batch${i}`, {
        id: `batch${i}`,
        name: "漢".repeat(20_000),
      });
    let revision = 0;
    const received = new Set<string>();
    const request = vi.fn(async (method: string, params: any) => {
      if (method === "sync.push") {
        expect(new TextEncoder().encode(JSON.stringify(params)).byteLength).toBeLessThan(
          1024 * 1024,
        );
        for (const op of params.ops) received.add(op.id);
        return {
          rev: revision,
          rejected: [],
          applied: params.ops.map((op: any) => ({
            table: op.table,
            id: op.id,
            rev: ++revision,
          })),
        };
      }
      return { rev: revision, records: [] };
    });
    await runSyncCycle(MACHINE, request);
    expect([...received].filter((id) => id.startsWith("batch"))).toHaveLength(100);
    expect(request.mock.calls.filter(([method]) => method === "sync.push").length).toBeGreaterThan(
      1,
    );
    expect(getSyncStatus(MACHINE).pendingOps).toBe(0);
  });
  it("finishes all pull pages before marking the initial pull complete and resumes a failed page", async () => {
    let failed = true;
    const request = vi.fn(async (method: string, params: any) => {
      if (method === "sync.push") return { rev: 2, applied: [], rejected: [] };
      if (params.sinceRev === 0)
        return {
          rev: 1,
          more: true,
          untilRev: 2,
          records: [
            {
              table: "group",
              id: "page-one",
              rev: 1,
              value: { id: "page-one", name: "First" },
            },
          ],
        };
      if (failed) throw new Error("page disconnected");
      return {
        rev: 2,
        more: false,
        untilRev: 2,
        records: [
          {
            table: "group",
            id: "page-two",
            rev: 2,
            value: { id: "page-two", name: "Second" },
          },
        ],
      };
    });
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(runSyncCycle(MACHINE, request)).rejects.toThrow("page disconnected");
      expect(peerRev(MACHINE)).toBe(1);
      expect(loadPeerState(MACHINE).pulled).toBe(false);
      expect(request.mock.calls.some(([method]) => method === "sync.push")).toBe(false);
      failed = false;
      await runSyncCycle(MACHINE, request);
      expect(peerRev(MACHINE)).toBe(2);
      expect(loadProjectGroups().map((group) => group.name)).toEqual(
        expect.arrayContaining(["First", "Second"]),
      );
    } finally {
      log.mockRestore();
    }
  });

  it("retains rejected oversized changes in the outbox and exposes a sync error", async () => {
    queueLocalChange(MACHINE, "group", "large", {
      id: "large",
      name: "😀".repeat(20_000),
    });
    const request = vi.fn(async (method: string) =>
      method === "sync.push"
        ? {
            rev: 0,
            applied: [],
            rejected: [],
            invalid: [{ table: "group", id: "large", error: "too large" }],
          }
        : { rev: 0, records: [] },
    );
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(runSyncCycle(MACHINE, request)).rejects.toThrow("remain pending");
      expect(getSyncStatus(MACHINE).state).toBe("error");
      expect(getSyncStatus(MACHINE).pendingOps).toBeGreaterThan(0);
    } finally {
      log.mockRestore();
    }
  });

  it("pushes the outbox, then pulls and applies what the host returns", async () => {
    saveProjectGroups([{ id: "g1", name: "Mine", collapsed: false }]);
    queueLocalChange(MACHINE, "group", "g1", {
      id: "g1",
      name: "Mine",
      collapsed: false,
    });
    const request = vi.fn(async (method: string, params: any) => {
      if (method === "sync.push") {
        expect(params.ops).toEqual(
          expect.arrayContaining([
            {
              table: "group",
              id: "g1",
              baseRev: 0,
              value: { id: "g1", name: "Mine" },
            },
          ]),
        );
        return {
          rev: 5,
          applied: [{ table: "group", id: "g1", rev: 5 }],
          rejected: [],
        };
      }
      if (method === "sync.pull") {
        if (params.sinceRev !== 0) return { rev: 6, records: [] };
        return {
          rev: 6,
          records: [
            {
              table: "group",
              id: "g2",
              rev: 6,
              value: { id: "g2", name: "Theirs", collapsed: false },
            },
          ],
        };
      }
      throw new Error(`unexpected method ${method}`);
    });

    await runSyncCycle(MACHINE, request);

    expect(request).toHaveBeenCalledWith("sync.push", {
      ops: expect.any(Array),
    });
    // First contact pulls before pushing, then pulls again after the push.
    expect(
      request.mock.calls.map(([method, params]) => `${method}:${params.sinceRev ?? ""}`),
    ).toEqual(["sync.pull:0", "sync.push:", "sync.pull:6"]);
    expect(
      loadProjectGroups()
        .map((g) => g.id)
        .sort(),
    ).toEqual(["g1", "g2"]);
    expect(peerRev(MACHINE)).toBe(6);
  });

  it("skips the push call when the outbox is empty", async () => {
    const accept = vi.fn(async (method: string, params: any) => {
      if (method === "sync.push") {
        return {
          rev: 1,
          applied: params.ops.map((op: any) => ({
            table: op.table,
            id: op.id,
            rev: 1,
          })),
          rejected: [],
        };
      }
      return { rev: 1, records: [] };
    });
    await runSyncCycle(MACHINE, accept);

    const request = vi.fn(async (method: string) => {
      if (method === "sync.pull") return { rev: 1, records: [] };
      throw new Error(`unexpected method ${method}`);
    });
    await runSyncCycle(MACHINE, request);
    expect(request).not.toHaveBeenCalledWith("sync.push", expect.anything());
  });

  it("starts over with a host whose revisions restarted after it was replaced", async () => {
    const first = vi.fn(async (method: string) => {
      if (method === "sync.pull") return { rev: 40, records: [] };
      return { rev: 40, applied: [], rejected: [] };
    });
    await runSyncCycle(MACHINE, first);
    expect(peerRev(MACHINE)).toBe(40);

    // A new host database: its history begins again below this desktop's cursor.
    const pulls: number[] = [];
    const replaced = vi.fn(async (method: string, params?: unknown) => {
      if (method === "sync.pull") {
        const since = (params as { sinceRev: number }).sinceRev;
        pulls.push(since);
        return {
          rev: 3,
          records: [
            {
              table: "group",
              id: "g9",
              rev: 3,
              value: { id: "g9", name: "From new host", collapsed: false },
            },
          ],
        };
      }
      return { rev: 3, applied: [], rejected: [] };
    });
    await runSyncCycle(MACHINE, replaced);

    expect(pulls.slice(0, 2)).toEqual([40, 0]);
    expect(peerRev(MACHINE)).toBe(3);
    expect(getSyncStatus(MACHINE)?.state).toBe("ok");
    expect(loadProjectGroups().some((group) => group.name === "From new host")).toBe(true);
  });

  it("re-pulls everything when the machine answers as a new host environment", async () => {
    const pull = (rev: number) =>
      vi.fn(async (method: string, params?: unknown) => {
        if (method !== "sync.pull") return { rev, applied: [], rejected: [] };
        return {
          rev,
          records:
            (params as { sinceRev: number }).sinceRev === 0
              ? [
                  {
                    table: "group",
                    id: "g7",
                    rev: 2,
                    value: { id: "g7", name: "Early on new host", collapsed: false },
                  },
                ]
              : [],
        };
      });
    await runSyncCycle(MACHINE, pull(40), "env-old");
    expect(peerRev(MACHINE)).toBe(40);

    // Same saved machine, replaced host: its revisions are higher than ours,
    // so only the environment shows that earlier records were never seen.
    const replaced = pull(500);
    await runSyncCycle(MACHINE, replaced, "env-new");
    expect(replaced).toHaveBeenCalledWith("sync.pull", expect.objectContaining({ sinceRev: 0 }));
    expect(loadPeerState(MACHINE).environmentId).toBe("env-new");
    expect(loadProjectGroups().some((group) => group.name === "Early on new host")).toBe(true);
  });

  it("keeps an older cache that has no environment and records the current one", async () => {
    await runSyncCycle(MACHINE, async (method: string) =>
      method === "sync.pull" ? { rev: 12, records: [] } : { rev: 12, applied: [], rejected: [] },
    );
    const later = vi.fn(async (method: string) =>
      method === "sync.pull" ? { rev: 12, records: [] } : { rev: 12, applied: [], rejected: [] },
    );
    await runSyncCycle(MACHINE, later, "env-a");
    expect(later).toHaveBeenCalledWith("sync.pull", expect.objectContaining({ sinceRev: 12 }));
    expect(loadPeerState(MACHINE).environmentId).toBe("env-a");
  });

  it("still refuses a host whose revision keeps going backwards", async () => {
    await runSyncCycle(MACHINE, async (method: string) =>
      method === "sync.pull" ? { rev: 40, records: [] } : { rev: 40, applied: [], rejected: [] },
    );
    let rev = 30;
    await expect(
      runSyncCycle(MACHINE, async (method: string, params?: unknown) => {
        if (method !== "sync.pull") return { rev, applied: [], rejected: [] };
        const since = (params as { sinceRev: number }).sinceRev;
        rev = since - 1;
        return { rev, records: [] };
      }),
    ).rejects.toThrow("invalid revision");
  });

  it("applies the host's current value for a rejected push and clears the outbox", async () => {
    saveProjectGroups([{ id: "g1", name: "Mine", collapsed: false }]);
    queueLocalChange(MACHINE, "group", "g1", {
      id: "g1",
      name: "Mine",
      collapsed: false,
    });
    const request = vi.fn(async (method: string) => {
      if (method === "sync.push") {
        return {
          rev: 7,
          applied: [],
          rejected: [
            {
              table: "group",
              id: "g1",
              current: {
                table: "group",
                id: "g1",
                rev: 7,
                value: { id: "g1", name: "Theirs", collapsed: false },
              },
            },
          ],
        };
      }
      if (method === "sync.pull") return { rev: 7, records: [] };
      throw new Error(`unexpected method ${method}`);
    });

    await runSyncCycle(MACHINE, request);

    expect(loadProjectGroups().find((g) => g.id === "g1")?.name).toBe("Theirs");
    expect(
      loadPeerState(MACHINE).outbox.find((op) => op.table === "group" && op.id === "g1"),
    ).toBeUndefined();
  });

  it("notifies listeners when a rejected push overwrites a differing local edit, not on a plain pull", async () => {
    saveProjectGroups([{ id: "g1", name: "Mine", collapsed: false }]);
    queueLocalChange(MACHINE, "group", "g1", {
      id: "g1",
      name: "Mine",
      collapsed: false,
    });
    const listener = vi.fn();
    const off = subscribeSyncMerged(listener);
    const rejecting = async (method: string) =>
      method === "sync.push"
        ? {
            rev: 7,
            applied: [],
            rejected: [
              {
                table: "group",
                id: "g1",
                current: {
                  table: "group",
                  id: "g1",
                  rev: 7,
                  value: { id: "g1", name: "Theirs", collapsed: false },
                },
              },
            ],
          }
        : { rev: 7, records: [] };
    await runSyncCycle(MACHINE, rejecting);
    expect(listener).toHaveBeenCalledTimes(1);
    const pulling = async (method: string) => ({
      rev: 9,
      records: [
        {
          table: "group",
          id: "g1",
          rev: 9,
          value: { id: "g1", name: "Again", collapsed: false },
        },
      ],
      applied: [],
      rejected: [],
    });
    await runSyncCycle(MACHINE, pulling);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it("ignores malformed pulled records", async () => {
    const request = vi.fn(async (method: string, params: any) => {
      if (method === "sync.push") {
        return {
          rev: 0,
          applied: params.ops.map((op: any) => ({
            table: op.table,
            id: op.id,
            rev: 1,
          })),
          rejected: [],
        };
      }
      if (method === "sync.pull") {
        return {
          rev: 3,
          records: [
            null,
            { table: "nope", id: "x", rev: 2, value: {} },
            {
              table: "group",
              id: "g9",
              rev: 3,
              value: { id: "g9", name: "Ok", collapsed: false },
            },
          ],
        };
      }
      throw new Error(`unexpected method ${method}`);
    });

    await runSyncCycle(MACHINE, request);

    expect(loadProjectGroups().map((g) => g.id)).toEqual(["g9"]);
    expect(peerRev(MACHINE)).toBe(3);
  });

  it("throws when the host returns a non-object result", async () => {
    const request = vi.fn(async () => "garbage");
    await expect(runSyncCycle(MACHINE, request)).rejects.toThrow();
  });
});

describe("sync status", () => {
  beforeEach(mockLocalStorage);

  it("goes syncing -> ok and notifies subscribers", async () => {
    const seen: string[] = [];
    const off = subscribeSyncStatus(() => seen.push(getSyncStatus("st-ok").state));
    await runSyncCycle("st-ok", async () => ({ rev: 1, records: [] }));
    off();
    expect(seen).toEqual(["syncing", "ok"]);
    const status = getSyncStatus("st-ok");
    expect(status.lastSyncAt).toBeGreaterThan(0);
    expect(status.pendingOps).toBeGreaterThanOrEqual(0);
  });

  it("records the real error text and warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(
      runSyncCycle("st-err", async () => {
        throw new Error("Machine is unreachable");
      }),
    ).rejects.toThrow();
    expect(getSyncStatus("st-err")).toMatchObject({
      state: "error",
      lastError: "Machine is unreachable",
    });
    expect(warn).toHaveBeenCalledWith("[sync]", "st-err", expect.any(Error));
    warn.mockRestore();
  });

  it("syncNow is a no-op without a loop and runs a cycle through a running one", async () => {
    await syncNow("st-now");
    expect(getSyncStatus("st-now").state).toBe("idle");
    const request = vi.fn(async () => ({ rev: 1, records: [] }));
    const loop = startSyncLoop(
      () => ["st-now"],
      () => request,
    );
    await syncNow("st-now");
    expect(getSyncStatus("st-now").state).toBe("ok");
    loop.stop();
  });

  it("syncNow marks a machine the loop does not sync as unsupported, replacing a stale error", async () => {
    recordSyncStatus("st-gone", {
      state: "error",
      lastError: "Machine is unreachable",
    });
    const request = vi.fn(async () => ({ rev: 1, records: [] }));
    const loop = startSyncLoop(
      () => [],
      () => request,
    );
    await syncNow();
    await syncNow("st-gone");
    loop.stop();
    expect(getSyncStatus("st-gone")).toMatchObject({
      state: "unsupported",
      lastError: SYNC_UNSUPPORTED_MESSAGE,
    });
    expect(request).not.toHaveBeenCalled();
  });
});

describe("sync loop pacing", () => {
  beforeEach(() => {
    mockLocalStorage();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps cycles at least 3 s apart, collapses nudges into one trailing run, and idles at 30 s", async () => {
    const request = async () => ({
      rev: 1,
      records: [],
      applied: [],
      rejected: [],
    });
    const cycles = vi.fn(() => ["pace-1"]);
    const loop = startSyncLoop(cycles, () => request);
    await vi.advanceTimersByTimeAsync(0);
    expect(cycles).toHaveBeenCalledTimes(1);

    loop.nudge();
    loop.nudge();
    loop.nudge();
    await vi.advanceTimersByTimeAsync(MIN_CYCLE_SPACING_MS - 1);
    expect(cycles).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(cycles).toHaveBeenCalledTimes(2);

    // No nudge: nothing until the 30 s poll.
    await vi.advanceTimersByTimeAsync(CYCLE_INTERVAL_MS - MIN_CYCLE_SPACING_MS - 1);
    expect(cycles).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(cycles).toHaveBeenCalledTimes(3);
    expect(CYCLE_INTERVAL_MS).toBe(30_000);
    expect(MIN_CYCLE_SPACING_MS).toBe(3_000);

    loop.nudge();
    loop.stop();
    await vi.advanceTimersByTimeAsync(CYCLE_INTERVAL_MS * 2);
    expect(cycles).toHaveBeenCalledTimes(3);
  });

  it("a nudge during a running cycle schedules exactly one trailing run after the spacing", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const request = async () => {
      await gate;
      return { rev: 1, records: [], applied: [], rejected: [] };
    };
    const cycles = vi.fn(() => ["pace-2"]);
    const loop = startSyncLoop(cycles, () => request);
    await vi.advanceTimersByTimeAsync(10);
    loop.nudge();
    loop.nudge();
    expect(cycles).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(MIN_CYCLE_SPACING_MS - 1);
    expect(cycles).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(cycles).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(MIN_CYCLE_SPACING_MS * 2);
    expect(cycles).toHaveBeenCalledTimes(2);
    loop.stop();
  });
});

describe("per-machine scheduling", () => {
  beforeEach(() => {
    mockLocalStorage();
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const ok = { rev: 1, records: [], applied: [], rejected: [] };

  it("an offline machine does not delay a healthy one", async () => {
    let fail: (error: Error) => void = () => undefined;
    const hang = new Promise<never>((_, reject) => (fail = reject));
    const loop = startSyncLoop(
      () => ["par-a", "par-b"],
      (id) => (id === "par-a" ? () => hang : async () => ok),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(getSyncStatus("par-a").state).toBe("syncing");
    expect(getSyncStatus("par-b").state).toBe("ok");
    fail(new Error("timed out"));
    await vi.advanceTimersByTimeAsync(0);
    expect(getSyncStatus("par-a").state).toBe("error");
    loop.stop();
  });

  it("runs at most MAX_PARALLEL_SYNCS machines at once", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const started: string[] = [];
    const ids = ["lim-1", "lim-2", "lim-3", "lim-4", "lim-5"];
    const loop = startSyncLoop(
      () => ids,
      (id) => async () => {
        if (!started.includes(id)) started.push(id);
        await gate;
        return ok;
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toHaveLength(MAX_PARALLEL_SYNCS);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(ids);
    loop.stop();
  });

  it("syncNow(machine) during a running sync resolves only after a later sync of that machine", async () => {
    const gates: Array<() => void> = [];
    let starts = 0;
    const loop = startSyncLoop(
      () => ["now-b"],
      () => {
        const gate = new Promise<void>((resolve) => gates.push(resolve));
        starts += 1;
        return async () => {
          await gate;
          return ok;
        };
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toBe(1);
    let done = false;
    const asked = syncNow("now-b").then(() => (done = true));
    const askedAgain = syncNow("now-b");
    gates[0]();
    await vi.advanceTimersByTimeAsync(0);
    // The sync that was running when asked finished; a new one has started.
    expect(starts).toBe(2);
    expect(done).toBe(false);
    gates[1]();
    await Promise.all([asked, askedAgain]);
    expect(done).toBe(true);
    // Both callers shared exactly one follow-up.
    expect(starts).toBe(2);
    loop.stop();
  });

  it("a failing machine backs off on its own while healthy machines keep the normal cadence", async () => {
    const counts = new Map<string, number>();
    const loop = startSyncLoop(
      () => ["bo-bad", "bo-good"],
      (id) => {
        counts.set(id, (counts.get(id) ?? 0) + 1);
        return id === "bo-bad"
          ? async () => {
              throw new Error("unreachable");
            }
          : async () => ok;
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect([counts.get("bo-bad"), counts.get("bo-good")]).toEqual([1, 1]);
    await vi.advanceTimersByTimeAsync(CYCLE_INTERVAL_MS);
    expect([counts.get("bo-bad"), counts.get("bo-good")]).toEqual([1, 2]);
    // Past the longest first backoff (60 s + 20 % jitter).
    await vi.advanceTimersByTimeAsync(SYNC_BACKOFF_BASE_MS * 1.2);
    expect(counts.get("bo-bad")).toBe(2);
    expect(counts.get("bo-good")).toBeGreaterThan(2);
    loop.stop();
  });

  it("a verified recovery clears only that peer's backoff and coalesces wakeups", async () => {
    const counts = new Map<string, number>();
    let online = false;
    const loop = startSyncLoop(
      () => ["recover-peer", "still-offline"],
      (id) => {
        counts.set(id, (counts.get(id) ?? 0) + 1);
        return async () => {
          if (!online || id === "still-offline") throw new Error("host offline");
          return { rev: 0, records: [] };
        };
      },
    );
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(counts.get("recover-peer")).toBe(1);
      online = true;
      loop.recover("recover-peer");
      loop.recover("recover-peer");
      await vi.advanceTimersByTimeAsync(MIN_CYCLE_SPACING_MS);
      expect(counts.get("recover-peer")).toBe(2);
      expect(counts.get("still-offline")).toBe(1);
      expect(getSyncStatus("recover-peer").state).toBe("ok");
    } finally {
      loop.stop();
    }
    loop.recover("recover-peer");
    await vi.advanceTimersByTimeAsync(MIN_CYCLE_SPACING_MS);
    expect(counts.get("recover-peer")).toBe(2);
  });

  it("an explicit syncNow ignores the failure backoff", async () => {
    let starts = 0;
    const loop = startSyncLoop(
      () => ["ex-bad"],
      () => {
        starts += 1;
        return async () => {
          throw new Error("unreachable");
        };
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    await syncNow("ex-bad");
    expect(starts).toBe(2);
    loop.stop();
  });
});

describe("syncBackoffMs", () => {
  it("grows exponentially, is capped, and jitters by +-20%", () => {
    expect(syncBackoffMs(0)).toBe(0);
    expect(syncBackoffMs(1, () => 0.5)).toBe(SYNC_BACKOFF_BASE_MS);
    expect(syncBackoffMs(2, () => 0.5)).toBe(SYNC_BACKOFF_BASE_MS * 2);
    expect(syncBackoffMs(30, () => 1)).toBe(SYNC_BACKOFF_MAX_MS);
    expect(syncBackoffMs(1, () => 0)).toBe(SYNC_BACKOFF_BASE_MS * 0.8);
    expect(syncBackoffMs(1, () => 1)).toBe(SYNC_BACKOFF_BASE_MS * 1.2);
  });
});
