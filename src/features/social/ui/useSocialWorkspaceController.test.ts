// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialSnapshot } from "../model/social";
import { useSocialWorkspaceController } from "./useSocialWorkspaceController";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  projects: vi.fn(),
  workspaceSnapshot: vi.fn(),
  snapshot: vi.fn(),
  schedulers: { created: 0, started: 0, stopped: 0 },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../connections/model/connections", () => ({
  remoteRequest: (id: string, method: string, params: unknown, fresh?: boolean) =>
    mocks.projects(id, method, params, fresh),
}));
vi.mock("../model/socialClient", () => ({
  socialClient: (id: string) => ({
    snapshot: () => mocks.snapshot(id),
    workspaceSnapshot: (input: unknown, fresh?: boolean) =>
      mocks.workspaceSnapshot(id, input, fresh),
    request: vi.fn(),
  }),
}));
// Real scheduler, counted: every instance must be stopped before the next Host starts one.
vi.mock("../../automations/model/refreshScheduler", async (original) => {
  const actual = await original<typeof import("../../automations/model/refreshScheduler")>();
  return {
    ...actual,
    createRefreshScheduler: (options: Parameters<typeof actual.createRefreshScheduler>[0]) => {
      const scheduler = actual.createRefreshScheduler(options);
      mocks.schedulers.created++;
      return {
        ...scheduler,
        start() {
          mocks.schedulers.started++;
          scheduler.start();
        },
        stop() {
          mocks.schedulers.stopped++;
          scheduler.stop();
        },
      };
    },
  };
});

type Controller = ReturnType<typeof useSocialWorkspaceController>;
let latest: Controller;
function Probe() {
  const probed = useSocialWorkspaceController({ rootRef: { current: null } });
  // Publish the committed value to the test after render, not during it.
  useLayoutEffect(() => {
    latest = probed;
  });
  return null;
}

let container: HTMLDivElement;
let root: Root;

const snapshotFor = (executorId: string): SocialSnapshot =>
  ({
    executorId,
    hostOnline: true,
    sendingEnabled: false,
    stopped: false,
    pollingEnabled: false,
    accounts: [],
    campaigns: [],
    threads: [],
    contacts: [],
    segments: [],
    rules: [],
    jobs: [],
    drafts: [],
    profiles: [],
    capabilities: {},
  }) as unknown as SocialSnapshot;

const machine = (id: string) => ({
  id,
  name: `Host ${id}`,
  endpoint: `https://${id}.test`,
  environmentId: `env-${id}`,
  providers: [],
  capabilities: [],
});

type Held = { id: string; resolve: (executorId: string) => void };
let held: Held[] = [];
/** Holds the next workspace read of `id` until the test answers it. */
function holdRead(id: string) {
  let resolve!: (executorId: string) => void;
  const answer = new Promise<string>((done) => (resolve = done));
  held.push({ id, resolve });
  mocks.workspaceSnapshot.mockImplementationOnce(async (hostId: string) => ({
    cursor: `cursor-${hostId}`,
    unchanged: false,
    snapshot: snapshotFor(await answer),
  }));
  return resolve;
}

const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));
const reads = (id: string) =>
  mocks.workspaceSnapshot.mock.calls.filter(([hostId]) => hostId === id);
const projectReads = (id: string) => mocks.projects.mock.calls.filter(([hostId]) => hostId === id);

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  held = [];
  mocks.schedulers.created = mocks.schedulers.started = mocks.schedulers.stopped = 0;
  mocks.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "remote_machines") return [machine("A"), machine("B")];
    if (command === "social_authority_status") return { authorityMachineId: "A" };
    return null;
  });
  mocks.projects.mockReset().mockResolvedValue([{ id: "p1", cwd: "/p1", name: "Project" }]);
  mocks.snapshot.mockReset().mockImplementation(async (id: string) => snapshotFor(id));
  mocks.workspaceSnapshot.mockReset().mockImplementation(async (id: string) => ({
    cursor: `cursor-${id}`,
    unchanged: false,
    snapshot: snapshotFor(id),
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Probe)));
  await flush();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function showHost(id: string) {
  await act(async () => latest.actions.selectMachine(id));
  await flush();
}

describe("useSocialWorkspaceController Host switching", () => {
  it("opens the authority Host and reads it once with its project list", async () => {
    expect(latest.machineId).toBe("A");
    expect(latest.snapshot?.executorId).toBe("A");
    expect(reads("A")).toHaveLength(1);
    expect(projectReads("A")).toHaveLength(1);
    expect(mocks.schedulers).toMatchObject({ created: 1, started: 1, stopped: 0 });
  });

  it("creates no duplicate refresh timers across A to B to A", async () => {
    const baselineTimers = vi.getTimerCount();
    expect(baselineTimers).toBeGreaterThan(0);

    await showHost("B");
    expect(latest.machineId).toBe("B");
    await showHost("A");
    expect(latest.machineId).toBe("A");

    // Three schedulers were created, and only the last one is still alive.
    expect(mocks.schedulers).toMatchObject({ created: 3, started: 3, stopped: 2 });
    expect(vi.getTimerCount()).toBe(baselineTimers);

    // One interval produces exactly one read for the active Host and none for the other.
    const aBefore = reads("A").length;
    const bBefore = reads("B").length;
    await act(async () => void (await vi.advanceTimersByTimeAsync(15_000)));
    expect(reads("A")).toHaveLength(aBefore + 1);
    expect(reads("B")).toHaveLength(bBefore);
  });

  it("reads each Host once when it becomes active", async () => {
    await showHost("B");
    expect(reads("B")).toHaveLength(1);
    await showHost("A");
    expect(reads("A")).toHaveLength(2);
    expect(reads("B")).toHaveLength(1);
  });

  it("never shows A's snapshot while B is loading or after a late A answer", async () => {
    const lateA = holdRead("A");
    await act(async () => latest.actions.refreshNow());
    await flush();
    const answerB = holdRead("B");
    await showHost("B");

    // B has not answered: nothing from A is displayed.
    expect(latest.machineId).toBe("B");
    expect(latest.snapshot).toBeNull();
    expect(latest.sectionLoaded).toBe(false);

    // A's late answer is for a Host that is no longer shown.
    await act(async () => lateA("A-late"));
    await flush();
    expect(latest.snapshot).toBeNull();

    await act(async () => answerB("B"));
    await flush();
    expect(latest.snapshot?.executorId).toBe("B");

    // Back on A the retained A snapshot (not the late one, not B's) is restored.
    await showHost("A");
    expect(latest.snapshot?.executorId).toBe("A");
  });

  it("restores A's retained tab and project filter after visiting B", async () => {
    await act(async () => latest.actions.selectTab("Campaigns"));
    await flush();
    await act(async () => latest.actions.setProjectFilter("p1"));
    await flush();
    expect(latest.tab).toBe("Campaigns");
    expect(latest.filter).toBe("p1");

    await showHost("B");
    expect(latest.tab).toBe("Today");
    expect(latest.filter).toBe("");
    await act(async () => latest.actions.selectTab("Inbox"));
    await flush();

    await showHost("A");
    expect(latest.tab).toBe("Campaigns");
    expect(latest.filter).toBe("p1");
    expect(latest.section).toBe("campaigns");

    await showHost("B");
    expect(latest.tab).toBe("Inbox");
    expect(latest.filter).toBe("");
    expect(Array.from(new Set(latest.hosts.map(([id]) => id)))).toEqual(["A", "B"]);
  });
});

describe("useSocialWorkspaceController run", () => {
  it("triggers exactly one refresh of the active Host after a confirmed mutation", async () => {
    const readsBefore = reads("A").length;
    const projectsBefore = projectReads("A").length;
    const work = vi.fn(async () => undefined);

    let ok: boolean | undefined;
    await act(async () => {
      ok = await latest.actions.run(work, "Saved.");
    });
    await flush();

    expect(ok).toBe(true);
    expect(work).toHaveBeenCalledTimes(1);
    expect(reads("A")).toHaveLength(readsBefore + 1);
    // The refresh after a mutation also reloads the project list, once.
    expect(projectReads("A")).toHaveLength(projectsBefore + 1);
    expect(latest.status.notice).toBe("Saved.");
    expect(latest.status.busy).toBe(false);
    expect(mocks.schedulers.created).toBe(1);
  });

  it("does not refresh, or report success on, a Host that is no longer active", async () => {
    let finish!: () => void;
    const work = () => new Promise<void>((done) => (finish = done));
    let result: Promise<boolean> | undefined;
    await act(async () => {
      result = latest.actions.run(work, "Saved.");
    });
    await showHost("B");
    const readsA = reads("A").length;
    const readsB = reads("B").length;

    await act(async () => {
      finish();
      await result;
    });
    await flush();

    expect(reads("A")).toHaveLength(readsA);
    expect(reads("B")).toHaveLength(readsB);
    expect(latest.status.notice).toBe("");
    expect(latest.status.busy).toBe(false);
  });

  it("reports a failed mutation without refreshing", async () => {
    const readsBefore = reads("A").length;
    let ok: boolean | undefined;
    await act(async () => {
      ok = await latest.actions.run(async () => {
        throw new Error("Host rejected it");
      });
    });
    await flush();
    expect(ok).toBe(false);
    expect(latest.status.error).toBe("Host rejected it");
    expect(reads("A")).toHaveLength(readsBefore);
  });
});
