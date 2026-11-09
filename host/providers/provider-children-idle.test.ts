import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostChildBackend } from "../child-backend";
import {
  PROVIDER_CHILD_IDLE_MS,
  PROVIDER_CHILD_IDLE_SWEEP_MS,
  ProviderChildIdleReaper,
  createSessionIdleGate,
  logicalSessionId,
  type ProviderChildIdleGate,
} from "./provider-children-idle";
import {
  acquireHarnessBridge,
  configureChildBackend,
  createChildProcessHandle,
  spawnChild,
  unwatchChild,
  watchChild,
} from "../../src/integrations/harness/core/child";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type FakeChild = { name: string };

function reaperFixture(gate?: Partial<ProviderChildIdleGate>) {
  const clock = { now: 1_000_000 };
  const children = new Map<string, FakeChild>();
  const retired: string[] = [];
  const starting = new Set<string>();
  const full: ProviderChildIdleGate = {
    isBusy: () => false,
    canRetire: async () => true,
    ...gate,
  };
  const errors: unknown[] = [];
  const reaper = new ProviderChildIdleReaper<FakeChild>({
    children: () => children,
    retire: async (id, child) => {
      retired.push(id);
      if (children.get(id) === child) children.delete(id);
    },
    isStarting: (id) => starting.has(id),
    gate: () => full,
    now: () => clock.now,
    onError: (error) => errors.push(error),
  });
  const add = (id: string) => {
    const child = { name: id };
    children.set(id, child);
    reaper.touch(child);
    return child;
  };
  return { clock, children, retired, starting, errors, reaper, add };
}

describe("ProviderChildIdleReaper", () => {
  it("uses a ten minute idle window and a one minute sweep", () => {
    expect(PROVIDER_CHILD_IDLE_MS).toBe(10 * 60_000);
    expect(PROVIDER_CHILD_IDLE_SWEEP_MS).toBe(60_000);
  });

  it("stops a child after the idle window and keeps a younger one", async () => {
    const f = reaperFixture();
    f.add("old");
    f.clock.now += PROVIDER_CHILD_IDLE_MS - 1;
    f.add("young");
    expect(await f.reaper.sweep()).toBe(0);
    f.clock.now += 1;
    expect(await f.reaper.sweep()).toBe(1);
    expect(f.retired).toEqual(["old"]);
    expect([...f.children.keys()]).toEqual(["young"]);
  });

  it("restarts the window whenever the child shows activity", async () => {
    const f = reaperFixture();
    const child = f.add("a");
    f.clock.now += PROVIDER_CHILD_IDLE_MS - 1;
    f.reaper.touch(child);
    f.clock.now += PROVIDER_CHILD_IDLE_MS - 1;
    expect(await f.reaper.sweep()).toBe(0);
    f.clock.now += 1;
    expect(await f.reaper.sweep()).toBe(1);
  });

  it("never stops a child whose session is busy or starting", async () => {
    const busy = new Set(["busy"]);
    const f = reaperFixture({ isBusy: (id) => busy.has(id) });
    f.add("busy#2");
    f.add("starting");
    f.starting.add("starting");
    f.clock.now += PROVIDER_CHILD_IDLE_MS * 3;
    expect(await f.reaper.sweep()).toBe(0);
    expect(f.retired).toEqual([]);
    // The gate sees the logical session, not the `#n` child suffix.
    busy.clear();
    f.starting.clear();
    expect(await f.reaper.sweep()).toBe(2);
  });

  it("keeps children the gate refuses and does not re-read them every sweep", async () => {
    const canRetire = vi.fn(async () => false);
    const f = reaperFixture({ canRetire });
    f.add("cannot-resume");
    f.clock.now += PROVIDER_CHILD_IDLE_MS;
    await f.reaper.sweep();
    await f.reaper.sweep();
    expect(canRetire).toHaveBeenCalledTimes(1);
    expect(f.retired).toEqual([]);
    f.clock.now += PROVIDER_CHILD_IDLE_MS;
    await f.reaper.sweep();
    expect(canRetire).toHaveBeenCalledTimes(2);
  });

  it("does nothing until a gate is installed", async () => {
    const f = reaperFixture();
    const reaper = new ProviderChildIdleReaper<FakeChild>({
      children: () => f.children,
      retire: async (id) => void f.retired.push(id),
      isStarting: () => false,
      gate: () => undefined,
      now: () => f.clock.now,
    });
    const child = { name: "x" };
    f.children.set("x", child);
    reaper.touch(child);
    f.clock.now += PROVIDER_CHILD_IDLE_MS * 2;
    expect(await reaper.sweep()).toBe(0);
  });

  it("skips a child that became active while its stored state was read", async () => {
    let release!: (value: boolean) => void;
    const f = reaperFixture({ canRetire: () => new Promise<boolean>((r) => (release = r)) });
    const child = f.add("racing");
    f.clock.now += PROVIDER_CHILD_IDLE_MS;
    const sweep = f.reaper.sweep();
    await Promise.resolve();
    f.clock.now += 5;
    f.reaper.touch(child);
    release(true);
    expect(await sweep).toBe(0);
    expect(f.retired).toEqual([]);
  });

  it("reports a failed retirement and keeps sweeping the others", async () => {
    const f = reaperFixture();
    const failures: string[] = [];
    const reaper = new ProviderChildIdleReaper<FakeChild>({
      children: () => f.children,
      retire: async (id, child) => {
        if (id === "bad") throw new Error("stuck");
        f.children.delete(id);
        failures.push(`ok:${id}:${child.name}`);
      },
      isStarting: () => false,
      gate: () => ({ isBusy: () => false, canRetire: async () => true }),
      now: () => f.clock.now,
      onError: (error) => f.errors.push(error),
    });
    for (const id of ["bad", "good"]) {
      const child = { name: id };
      f.children.set(id, child);
      reaper.touch(child);
    }
    f.clock.now += PROVIDER_CHILD_IDLE_MS;
    expect(await reaper.sweep()).toBe(1);
    expect(failures).toEqual(["ok:good:good"]);
    expect(f.errors).toHaveLength(1);
  });

  it("sweeps on the interval and stops sweeping after stop()", async () => {
    vi.useFakeTimers();
    const f = reaperFixture();
    f.add("a");
    const spy = vi.spyOn(f.reaper, "sweep");
    f.reaper.start();
    f.clock.now += PROVIDER_CHILD_IDLE_MS;
    await vi.advanceTimersByTimeAsync(PROVIDER_CHILD_IDLE_SWEEP_MS);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(f.retired).toEqual(["a"]);
    f.reaper.stop();
    await vi.advanceTimersByTimeAsync(PROVIDER_CHILD_IDLE_SWEEP_MS * 3);
    expect(spy).toHaveBeenCalledTimes(1);
    f.reaper.start();
    await vi.advanceTimersByTimeAsync(PROVIDER_CHILD_IDLE_SWEEP_MS * 3);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("maps child ids to their logical session", () => {
    expect(logicalSessionId("session-1#3")).toBe("session-1");
    expect(logicalSessionId("session-1")).toBe("session-1");
  });
});

describe("createSessionIdleGate", () => {
  type Value = Parameters<typeof createSessionIdleGate>[1] extends {
    session(id: string): Promise<infer V>;
  }
    ? V
    : never;
  const idle = (patch: Record<string, unknown> = {}, status = "idle"): Value =>
    ({
      status,
      session: { harness: "claude", providerSessionId: "p-1", blocks: [], ...patch },
    }) as Value;
  const gateFor = (value: Value | Error, active = false) =>
    createSessionIdleGate(
      { hasActiveRun: () => active },
      {
        session: async () => {
          if (value instanceof Error) throw value;
          return value;
        },
      },
    );

  it("allows an idle, resumable session", async () => {
    expect(await gateFor(idle()).canRetire("s")).toBe(true);
    for (const harness of ["codex", "opencode", "cursor", "grok", "hermes", "pi", "antigravity"])
      expect(await gateFor(idle({ harness })).canRetire("s")).toBe(true);
  });

  it("reflects the engine's live run", () => {
    expect(gateFor(idle(), true).isBusy("s")).toBe(true);
    expect(gateFor(idle(), false).isBusy("s")).toBe(false);
  });

  it("refuses sessions that cannot resume", async () => {
    expect(await gateFor(idle({ providerSessionId: undefined })).canRetire("s")).toBe(false);
    expect(await gateFor(idle({ harness: "acp" })).canRetire("s")).toBe(false);
    expect(await gateFor(new Error("Session not found on this machine")).canRetire("u")).toBe(
      false,
    );
  });

  it("refuses sessions with a turn or anything pending", async () => {
    expect(await gateFor(idle({}, "running")).canRetire("s")).toBe(false);
    for (const patch of [
      { busy: true },
      { pendingQuestion: { requestId: "q" } },
      { pendingSwitch: {} },
      { backgroundTasks: ["task"] },
      { queuedMessages: [{}] },
      { blocks: [{ approval: { decided: undefined } }] },
      { blocks: [{ tool: { status: "running" } }] },
      { blocks: [{ agentRun: {} }] },
      { blocks: [{ shell: { running: true } }] },
      { blocks: [{ followUpDelivery: "pending" }] },
    ])
      expect(await gateFor(idle(patch)).canRetire("s")).toBe(false);
    expect(
      await gateFor(
        idle({ blocks: [{ approval: { decided: "allow" }, tool: { status: "completed" } }] }),
      ).canRetire("s"),
    ).toBe(true);
  });
});

describe("Host child backend idle teardown", () => {
  it("stops a quiet child, keeps a busy one, and relaunches on the next spawn", async () => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), "bycoda-idle-child-")));
    const provider = join(directory, "provider.cjs");
    writeFileSync(provider, `console.log('ready');setInterval(()=>{},1000);`);
    const backend = new HostChildBackend({});
    configureChildBackend(backend);
    const release = await acquireHarnessBridge();
    const busy = new Set<string>();
    backend.setIdleGate({ isBusy: (id) => busy.has(id), canRetire: async () => true });
    const sweep = () => (backend as unknown as { idle: { sweep(): Promise<number> } }).idle.sweep();
    const live = (id: string) =>
      (backend as unknown as { children: Map<string, { pid?: number }> }).children.get(id);
    const handles: ReturnType<typeof createChildProcessHandle>[] = [];
    const exits: Array<number | null> = [];
    const launch = async (id: string, onExit?: (code: number | null) => void) => {
      const handle = createChildProcessHandle(id);
      handles.push(handle);
      const lines: string[] = [];
      watchChild(
        handle,
        (line) => lines.push(line),
        (code) => {
          exits.push(code);
          onExit?.(code);
        },
      );
      await spawnChild(handle, provider, [], directory);
      await vi.waitFor(() => expect(lines).toContain("ready"), { timeout: 5000 });
    };
    try {
      await launch("idle-session");
      await launch("busy-session#1");
      busy.add("busy-session");
      const firstPid = live("idle-session")!.pid;

      // Inside the window nothing is touched.
      expect(await sweep()).toBe(0);
      expect(live("idle-session")).toBeDefined();

      const start = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(start + PROVIDER_CHILD_IDLE_MS + 1);
      expect(await sweep()).toBe(1);
      await vi.waitFor(() => expect(live("idle-session")).toBeUndefined(), { timeout: 10_000 });
      expect(live("busy-session#1")).toBeDefined();
      expect(exits).toHaveLength(1);

      // The next turn finds no child and starts a fresh one for the same session.
      vi.restoreAllMocks();
      await launch("idle-session");
      expect(live("idle-session")!.pid).not.toBe(firstPid);
    } finally {
      for (const handle of handles) unwatchChild(handle);
      release();
      await backend.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 40_000);

  it("stops its sweep timer on close", async () => {
    vi.useFakeTimers();
    const backend = new HostChildBackend({});
    backend.setIdleGate({ isBusy: () => false, canRetire: async () => true });
    const sweep = vi
      .spyOn((backend as unknown as { idle: { sweep(): Promise<number> } }).idle, "sweep")
      .mockResolvedValue(0);
    await vi.advanceTimersByTimeAsync(PROVIDER_CHILD_IDLE_SWEEP_MS);
    expect(sweep).toHaveBeenCalledTimes(1);
    await backend.close();
    await vi.advanceTimersByTimeAsync(PROVIDER_CHILD_IDLE_SWEEP_MS * 3);
    expect(sweep).toHaveBeenCalledTimes(1);
  });
});
