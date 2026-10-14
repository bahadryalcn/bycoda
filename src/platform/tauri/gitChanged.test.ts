// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { isGitWatched, notifyGitChanged, setRemoteGitWatcher, subscribeGitChanged } from "./fs";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

type Report = { cwd: string; index: boolean; refs: boolean };
const watchEvents = vi.hoisted(() => ({
  handler: null as ((event: { payload: Report[] }) => void) | null,
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    listen: vi.fn(async (_name: string, handler: (event: { payload: Report[] }) => void) => {
      watchEvents.handler = handler;
      return () => {};
    }),
  }),
}));

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function listen(filter?: { cwd?: string; refsOnly?: boolean }) {
  const listener = vi.fn();
  const stop = subscribeGitChanged(listener, filter);
  return { listener, stop };
}

describe("git change notifications", () => {
  it("reach every subscriber when no checkout is named", () => {
    const all = listen();
    const scoped = listen({ cwd: "/repo" });
    const refs = listen({ refsOnly: true });
    notifyGitChanged();
    for (const { listener, stop } of [all, scoped, refs]) {
      expect(listener).toHaveBeenCalledTimes(1);
      stop();
    }
  });

  it("keep an index change away from commit, branch and stash views", () => {
    const refs = listen({ refsOnly: true });
    const files = listen({ cwd: "/repo" });
    notifyGitChanged("/repo", "index");
    expect(refs.listener).not.toHaveBeenCalled();
    expect(files.listener).toHaveBeenCalledTimes(1);
    refs.stop();
    files.stop();
  });

  it("keep an index change away from other checkouts", () => {
    const other = listen({ cwd: "/elsewhere" });
    const nested = listen({ cwd: "/repo/packages/app" });
    const windows = listen({ cwd: "C:\\Repo\\" });
    notifyGitChanged("/repo", "index");
    notifyGitChanged("c:/repo/src", "index");
    expect(other.listener).not.toHaveBeenCalled();
    expect(nested.listener).toHaveBeenCalledTimes(1);
    expect(windows.listener).toHaveBeenCalledTimes(1);
    other.stop();
    nested.stop();
    windows.stop();
  });

  it("send a commit or checkout to every checkout", () => {
    const other = listen({ cwd: "/elsewhere" });
    const refs = listen({ refsOnly: true });
    notifyGitChanged("/repo", "refs");
    expect(other.listener).toHaveBeenCalledTimes(1);
    expect(refs.listener).toHaveBeenCalledTimes(1);
    other.stop();
    refs.stop();
  });

  it("keep a change inside one checkout away from other checkouts", () => {
    const other = listen({ cwd: "/elsewhere", refsOnly: true });
    const same = listen({ cwd: "/repo", refsOnly: true });
    const files = listen({ cwd: "/repo/src" });
    const all = listen();
    notifyGitChanged("/repo", "checkout");
    expect(other.listener).not.toHaveBeenCalled();
    expect(same.listener).toHaveBeenCalledTimes(1);
    expect(files.listener).toHaveBeenCalledTimes(1);
    expect(all.listener).toHaveBeenCalledTimes(1);
    for (const { stop } of [other, same, files, all]) stop();
  });

  it("watch a local checkout while subscribed and relay its .git changes", async () => {
    vi.mocked(invoke).mockClear();
    const refs = listen({ cwd: "/watched", refsOnly: true });
    const files = listen({ cwd: "/watched/src" });
    const other = listen({ cwd: "/elsewhere-watched", refsOnly: true });
    await settle();
    expect(invoke).toHaveBeenCalledWith("git_watch", { cwd: "/watched" });
    expect(isGitWatched("/watched")).toBe(true);

    watchEvents.handler!({ payload: [{ cwd: "/watched", index: true, refs: false }] });
    expect(refs.listener).not.toHaveBeenCalled();
    expect(files.listener).toHaveBeenCalledTimes(1);

    // Nested registrations of one checkout are told once.
    watchEvents.handler!({
      payload: [
        { cwd: "/watched", index: true, refs: true },
        { cwd: "/watched/src", index: true, refs: true },
      ],
    });
    expect(refs.listener).toHaveBeenCalledTimes(1);
    expect(files.listener).toHaveBeenCalledTimes(2);
    expect(other.listener).not.toHaveBeenCalled();

    for (const { stop } of [refs, files, other]) stop();
    expect(invoke).toHaveBeenCalledWith("git_unwatch", { cwd: "/watched" });
    expect(isGitWatched("/watched")).toBe(false);
  });

  it("leave remote checkouts and failed watches to their own triggers", async () => {
    vi.mocked(invoke).mockClear();
    const remote = listen({ cwd: "remote://machine/repo" });
    expect(invoke).not.toHaveBeenCalledWith("git_watch", expect.anything());
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "git_watch") throw new Error("not a Git checkout");
    });
    const plain = listen({ cwd: "/not-a-repo" });
    await settle();
    expect(isGitWatched("/not-a-repo")).toBe(false);
    plain.stop();
    remote.stop();
    expect(invoke).not.toHaveBeenCalledWith("git_unwatch", { cwd: "/not-a-repo" });
    vi.mocked(invoke).mockImplementation(async () => undefined);
  });

  it("share one remote watch per checkout and relay what the machine reports", () => {
    const remote = "remote://machine/repo";
    const calls: {
      report: (index: boolean, refs: boolean) => void;
      setWatching: (on: boolean) => void;
    }[] = [];
    const release = vi.fn();
    const watcher = vi.fn((_cwd: string, report, setWatching) => {
      calls.push({ report, setWatching });
      return release;
    });
    setRemoteGitWatcher(watcher);
    const first = listen({ cwd: remote });
    const second = listen({ cwd: remote, refsOnly: true });
    expect(watcher).toHaveBeenCalledTimes(1);
    expect(isGitWatched(remote)).toBe(false);

    calls[0].setWatching(true);
    expect(isGitWatched(remote)).toBe(true);
    calls[0].report(true, false);
    expect(first.listener).toHaveBeenCalledTimes(1);
    expect(second.listener).not.toHaveBeenCalled();
    calls[0].report(false, true);
    expect(second.listener).toHaveBeenCalledTimes(1);

    calls[0].setWatching(false);
    expect(isGitWatched(remote)).toBe(false);
    calls[0].setWatching(true);

    first.stop();
    expect(release).not.toHaveBeenCalled();
    second.stop();
    expect(release).toHaveBeenCalledTimes(1);
    expect(isGitWatched(remote)).toBe(false);
    // A late answer from a released watch changes nothing.
    calls[0].setWatching(true);
    expect(isGitWatched(remote)).toBe(false);
    setRemoteGitWatcher(undefined as never);
  });

  it("stop after unsubscribing", () => {
    const { listener, stop } = listen();
    stop();
    notifyGitChanged();
    expect(listener).not.toHaveBeenCalled();
  });
});
