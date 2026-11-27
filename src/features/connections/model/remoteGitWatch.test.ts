import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MachineChanges } from "./protocol";
import type { MachineChannelDemand, MachineChannelListener } from "./remoteMachineChannel";

const channel = vi.hoisted(() => ({
  subscribers: [] as {
    demand: () => MachineChannelDemand;
    listener: MachineChannelListener;
    stop: () => void;
  }[],
}));
const capabilities = vi.hoisted(() => ({
  value: ["git.watch"] as string[] | undefined,
  cached: true,
  loadFailures: 0,
  machineFailures: 0,
  loads: 0,
}));
const recovered = vi.hoisted(() => ({ listeners: new Set<() => void>() }));

vi.mock("../../../platform/tauri/fs", () => ({ setRemoteGitWatcher: vi.fn() }));
vi.mock("./connections", () => ({
  cachedRemoteCapabilities: () => (capabilities.cached ? capabilities.value : undefined),
  loadRemoteCapabilities: async () => {
    capabilities.loads += 1;
    if (capabilities.loadFailures > 0) {
      capabilities.loadFailures -= 1;
      throw new Error("describe timed out");
    }
    return capabilities.value;
  },
  remoteMachineFor: async () => {
    if (capabilities.machineFailures > 0) {
      capabilities.machineFailures -= 1;
      throw new Error("remote_machines failed");
    }
    return { id: "machine-1" };
  },
}));
vi.mock("./remoteHealth", () => ({
  subscribeRemoteRecovered: (listener: () => void) => {
    recovered.listeners.add(listener);
    return () => recovered.listeners.delete(listener);
  },
}));
vi.mock("./remoteMachineChannel", () => ({
  subscribeRemoteMachineChannel: vi.fn(
    (_machine: string, demand: () => MachineChannelDemand, listener: MachineChannelListener) => {
      const stop = vi.fn();
      channel.subscribers.push({ demand, listener, stop });
      return stop;
    },
  ),
}));

import {
  GIT_START_RETRY_DELAYS_MS,
  GIT_UNWATCHABLE_RETRY_MS,
  watchRemoteGit,
} from "./remoteGitWatch";

const CWD = "remote://env-1/home/me/repo";
const HOST = "/home/me/repo";
const settle = () => vi.advanceTimersByTimeAsync(0);
const answer = (git: MachineChanges["git"], reset = false) =>
  channel.subscribers.at(-1)!.listener({ instanceId: "i", reset, sessions: [], projects: [], git });
const entry = (etag: string, index = false, refs = false, watching = true) => ({
  cwd: HOST,
  etag,
  index,
  refs,
  watching,
});

function start() {
  const report = vi.fn();
  const setWatching = vi.fn();
  const stop = watchRemoteGit(CWD, report, setWatching);
  return { report, setWatching, stop };
}

describe("remote .git watch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    channel.subscribers.length = 0;
    capabilities.value = ["git.watch"];
    capabilities.cached = true;
    capabilities.loadFailures = 0;
    capabilities.machineFailures = 0;
    capabilities.loads = 0;
    recovered.listeners.clear();
  });
  afterEach(() => vi.useRealTimers());

  it("retries a failed capability read and starts watching once it answers", async () => {
    capabilities.cached = false;
    capabilities.loadFailures = 1;
    const { stop } = start();
    await settle();
    expect(channel.subscribers).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(GIT_START_RETRY_DELAYS_MS[0]);
    expect(channel.subscribers).toHaveLength(1);
    stop();
    expect(channel.subscribers[0].stop).toHaveBeenCalled();
  });

  it("handles a rejected machine lookup and retries it", async () => {
    capabilities.machineFailures = 1;
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const { stop } = start();
    await settle();
    expect(channel.subscribers).toHaveLength(0);
    expect(unhandled).not.toHaveBeenCalled();
    process.off("unhandledRejection", unhandled);

    await vi.advanceTimersByTimeAsync(GIT_START_RETRY_DELAYS_MS[0]);
    expect(channel.subscribers).toHaveLength(1);
    stop();
  });

  it("gives up after a bounded number of failed attempts until the machine recovers", async () => {
    capabilities.cached = false;
    capabilities.loadFailures = Number.POSITIVE_INFINITY;
    const { stop } = start();
    await settle();
    for (const delay of GIT_START_RETRY_DELAYS_MS) await vi.advanceTimersByTimeAsync(delay);
    expect(capabilities.loads).toBe(GIT_START_RETRY_DELAYS_MS.length + 1);

    await vi.advanceTimersByTimeAsync(GIT_UNWATCHABLE_RETRY_MS);
    expect(capabilities.loads).toBe(GIT_START_RETRY_DELAYS_MS.length + 1);

    capabilities.loadFailures = 0;
    for (const listener of recovered.listeners) listener();
    await settle();
    expect(channel.subscribers).toHaveLength(1);
    stop();
  });

  it("does not retry a host that answered without git.watch", async () => {
    capabilities.value = ["machine.changes"];
    capabilities.cached = false;
    const { stop } = start();
    await settle();
    await vi.advanceTimersByTimeAsync(GIT_UNWATCHABLE_RETRY_MS);
    expect(capabilities.loads).toBe(1);
    expect(channel.subscribers).toHaveLength(0);
    stop();
  });

  it("stops a pending retry on release", async () => {
    capabilities.cached = false;
    capabilities.loadFailures = 1;
    const { stop } = start();
    await settle();
    stop();
    await vi.advanceTimersByTimeAsync(GIT_UNWATCHABLE_RETRY_MS);
    expect(capabilities.loads).toBe(1);
    expect(channel.subscribers).toHaveLength(0);
  });

  it("never watches a host without git.watch", async () => {
    capabilities.value = ["machine.changes"];
    const { setWatching, stop } = start();
    await settle();
    expect(channel.subscribers).toHaveLength(0);
    expect(setWatching).not.toHaveBeenCalled();
    stop();
  });

  it("asks with the host path, baselines quietly, then reports changes", async () => {
    const { report, setWatching, stop } = start();
    await settle();
    const { demand } = channel.subscribers[0];
    expect(demand()).toEqual({ git: [{ cwd: HOST }] });

    // The lane's first poll reports a reset; nothing has been shown yet.
    answer([entry("0.0")], true);
    expect(setWatching).toHaveBeenCalledWith(true);
    expect(report).not.toHaveBeenCalled();
    expect(demand()).toEqual({ git: [{ cwd: HOST, known: "0.0" }] });

    answer([entry("1.0", true, false)]);
    expect(report).toHaveBeenLastCalledWith(true, false);
    answer([entry("1.1", false, true)]);
    expect(report).toHaveBeenLastCalledWith(false, true);
    expect(demand()).toEqual({ git: [{ cwd: HOST, known: "1.1" }] });

    // Another window's merged cursor hides what changed: refresh everything.
    answer([entry("2.2")]);
    expect(report).toHaveBeenLastCalledWith(true, true);

    // Other checkouts' answers are not ours.
    answer([{ ...entry("9.9", true, true), cwd: "/other" }]);
    expect(report).toHaveBeenCalledTimes(3);

    stop();
    expect(channel.subscribers[0].stop).toHaveBeenCalled();
  });

  it("treats a host restart as a change of everything and takes a new baseline", async () => {
    const { report, stop } = start();
    await settle();
    answer([entry("3.4")]);
    answer([], true);
    expect(report).toHaveBeenCalledWith(true, true);
    expect(channel.subscribers[0].demand()).toEqual({ git: [{ cwd: HOST }] });
    stop();
  });

  it("falls back and leaves the lane for a checkout the host cannot watch", async () => {
    const { setWatching, stop } = start();
    await settle();
    answer([entry("1.0")]);
    answer([entry("", false, false, false)]);
    expect(setWatching).toHaveBeenLastCalledWith(false);
    await settle();
    expect(channel.subscribers[0].stop).toHaveBeenCalled();
    expect(channel.subscribers).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(GIT_UNWATCHABLE_RETRY_MS);
    expect(channel.subscribers).toHaveLength(2);
    expect(channel.subscribers[1].demand()).toEqual({ git: [{ cwd: HOST }] });
    stop();
    expect(channel.subscribers[1].stop).toHaveBeenCalled();
  });

  it("does not subscribe after being released while capabilities load", async () => {
    const { stop } = start();
    stop();
    await settle();
    expect(channel.subscribers).toHaveLength(0);
  });
});
