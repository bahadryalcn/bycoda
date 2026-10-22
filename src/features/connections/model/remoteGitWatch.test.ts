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
const capabilities = vi.hoisted(() => ({ value: ["git.watch"] as string[] | undefined }));

vi.mock("../../../platform/tauri/fs", () => ({ setRemoteGitWatcher: vi.fn() }));
vi.mock("./connections", () => ({
  cachedRemoteCapabilities: () => capabilities.value,
  loadRemoteCapabilities: async () => capabilities.value,
  remoteMachineFor: async () => ({ id: "machine-1" }),
}));
vi.mock("./remoteHealth", () => ({ subscribeRemoteRecovered: () => () => {} }));
vi.mock("./remoteMachineChannel", () => ({
  subscribeRemoteMachineChannel: vi.fn(
    (_machine: string, demand: () => MachineChannelDemand, listener: MachineChannelListener) => {
      const stop = vi.fn();
      channel.subscribers.push({ demand, listener, stop });
      return stop;
    },
  ),
}));

import { GIT_UNWATCHABLE_RETRY_MS, watchRemoteGit } from "./remoteGitWatch";

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
  });
  afterEach(() => vi.useRealTimers());

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
