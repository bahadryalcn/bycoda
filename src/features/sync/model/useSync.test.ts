import { getSyncStatus, isApplyingRemote, recordSyncStatus, runSyncCycle } from "./syncClient";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadProjectGroups, saveProjectGroups } from "../../projects/model/projectGroups";
import { subscribeProjectPathsChanged } from "../../projects/model/recents";
import {
  SYNC_UNSUPPORTED_MESSAGE,
  collectSyncMachineIds,
  createDebouncer,
  createLocalChangeHandler,
  machineSupportsSync,
  recordCapabilityStatus,
  shouldLoadCapabilities,
  syncMachineRoles,
  UNSUPPORTED_RECHECK_MS,
} from "./useSync";
import { LOCAL_SYNC_MACHINE_NAME } from "../../connections/model/localSync";

describe("syncMachineRoles", () => {
  const own = {
    id: "l",
    name: LOCAL_SYNC_MACHINE_NAME,
    endpoint: "http://127.0.0.1:4567",
    environmentId: "env-own",
  };
  const pc = {
    id: "m1",
    name: "PC",
    endpoint: "http://127.0.0.1:5000",
    environmentId: "env-pc",
    ssh: { target: "me@pc", remotePort: 3774 },
  };

  it("names this desktop's own host and the machines projects can be opened on", () => {
    expect(syncMachineRoles([own, pc])).toEqual({ hostEnvironmentId: "env-own", openable: [pc] });
  });

  it("never opens projects on this desktop's own host, however it is saved", () => {
    const alias = { ...pc, id: "m2", name: "Me over SSH", environmentId: "env-own" };
    const twice = { ...pc, id: "m3", name: "PC again" };
    expect(syncMachineRoles([own, alias, pc, twice]).openable).toEqual([pc]);
  });

  it("has no own host when none is linked", () => {
    expect(syncMachineRoles([pc])).toEqual({ openable: [pc] });
    expect(syncMachineRoles([])).toEqual({ openable: [] });
  });
});

describe("collectSyncMachineIds", () => {
  it("returns every known machine id", () => {
    const ids = collectSyncMachineIds([
      { id: "m1", name: "A", endpoint: "https://a", environmentId: "e1", ssh: null },
      { id: "m2", name: "B", endpoint: "https://b", environmentId: "e2", ssh: null },
    ]);
    expect(ids).toEqual(["m1", "m2"]);
  });
});

describe("machineSupportsSync", () => {
  it("is true only when the host advertises sync", () => {
    expect(machineSupportsSync(["sessions", "sync"])).toBe(true);
    expect(machineSupportsSync(["sessions"])).toBe(false);
    expect(machineSupportsSync([])).toBe(false);
    expect(machineSupportsSync(undefined)).toBe(false);
  });
});

describe("shouldLoadCapabilities", () => {
  it("loads when unknown, rechecks unsupported after 5 minutes, never rechecks supported", () => {
    expect(shouldLoadCapabilities(undefined, undefined, 0)).toBe(true);
    expect(shouldLoadCapabilities(["sync"], 0, 10 * UNSUPPORTED_RECHECK_MS)).toBe(false);
    expect(shouldLoadCapabilities([], undefined, 0)).toBe(true);
    expect(shouldLoadCapabilities([], 1000, 1000 + UNSUPPORTED_RECHECK_MS - 1)).toBe(false);
    expect(shouldLoadCapabilities(["sessions"], 1000, 1000 + UNSUPPORTED_RECHECK_MS)).toBe(true);
  });
});

describe("createDebouncer", () => {
  it("collapses bursts into one trailing call and can be cancelled", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const d = createDebouncer(run, 500);
    d.trigger();
    vi.advanceTimersByTime(300);
    d.trigger();
    vi.advanceTimersByTime(499);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    d.trigger();
    d.cancel();
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("recordCapabilityStatus", () => {
  it("marks hosts without sync as unsupported and unreadable ones as unlinked", () => {
    recordCapabilityStatus("cap-old", ["sessions"]);
    expect(getSyncStatus("cap-old").state).toBe("unsupported");
    recordCapabilityStatus("cap-none", undefined);
    expect(getSyncStatus("cap-none").state).toBe("unlinked");
    recordCapabilityStatus("cap-new", ["sync"]);
    expect(getSyncStatus("cap-new").state).toBe("idle");
  });

  it("replaces a stale error when the machine turns out to be unsupported", () => {
    recordSyncStatus("cap-stale", { state: "error", lastError: "Machine is unreachable" });
    recordCapabilityStatus("cap-stale", ["sessions"]);
    expect(getSyncStatus("cap-stale")).toMatchObject({
      state: "unsupported",
      lastError: SYNC_UNSUPPORTED_MESSAGE,
    });
  });
});

describe("createLocalChangeHandler", () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    });
    vi.stubGlobal("window", new EventTarget());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ignores the change events sync itself causes, but not real local edits", async () => {
    const nudge = vi.fn();
    const unsubscribe = subscribeProjectPathsChanged(createLocalChangeHandler(nudge));
    saveProjectGroups([{ id: "g1", name: "Mine", collapsed: false }]);
    expect(nudge).toHaveBeenCalledTimes(1);

    const events = vi.fn();
    const unsubscribeAll = subscribeProjectPathsChanged(events);
    let rev = 0;
    const request = async (method: string, params: any) => {
      if (method === "sync.push") {
        return {
          rev: (rev += 1),
          applied: [],
          rejected: params.ops
            .filter((op: any) => op.table === "group")
            .map((op: any) => ({
              table: op.table,
              id: op.id,
              current: { table: op.table, id: op.id, rev, value: { id: op.id, name: "Theirs" } },
            })),
        };
      }
      return {
        rev: (rev += 1),
        records: [
          {
            table: "group",
            id: `remote-${rev}`,
            rev,
            value: { id: `remote-${rev}`, name: "Remote" },
          },
        ],
      };
    };
    await runSyncCycle("nudge-1", request);
    unsubscribeAll();

    expect(loadProjectGroups().map((group) => group.name)).toEqual(["Theirs", "Remote", "Remote"]);
    expect(events).toHaveBeenCalled();
    expect(nudge).toHaveBeenCalledTimes(1);
    expect(isApplyingRemote()).toBe(false);

    saveProjectGroups([]);
    expect(nudge).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
