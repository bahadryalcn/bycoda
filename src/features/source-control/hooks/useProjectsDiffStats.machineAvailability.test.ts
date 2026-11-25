// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { gitDiffStats } = vi.hoisted(() => ({ gitDiffStats: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
vi.mock("../../../platform/tauri/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/fs")>()),
  gitDiffStats,
}));

import { adoptRemoteMachineInventory } from "../../connections/model/connections";
import { recordRemoteConnection, resetRemoteHealth } from "../../connections/model/remoteHealth";
import { remotePath } from "../../connections/model/remoteProjects";
import { notifyGitChanged } from "../../../platform/tauri/fs";
import {
  applyProjectDiffStats,
  useProjectDiffStats,
  useProjectsDiffStats,
} from "./useProjectDiffStats";

const MACHINE = { id: "m1", name: "Desk", endpoint: "http://desk", environmentId: "env" };
const STATS = { files: 1, additions: 2, deletions: 3 };
let serial = 0;
let cwd: string;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  resetRemoteHealth();
  adoptRemoteMachineInventory([MACHINE]);
  gitDiffStats.mockReset().mockResolvedValue(STATS);
  cwd = remotePath("env", `G:/Projects/stats-${serial++}`);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  adoptRemoteMachineInventory([]);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function Rail() {
  useProjectsDiffStats([cwd], true);
  return null;
}

it("reads a project's counts once its offline machine answers again", async () => {
  recordRemoteConnection("env", "Machine is unreachable");
  await act(async () => root.render(createElement(Rail)));
  expect(gitDiffStats).not.toHaveBeenCalled();

  await act(async () => recordRemoteConnection("env"));

  expect(gitDiffStats).toHaveBeenCalledTimes(1);
});

it("stops reading a project's counts while its machine is offline", async () => {
  await act(async () => root.render(createElement(Rail)));
  expect(gitDiffStats).toHaveBeenCalledTimes(1);

  await act(async () => recordRemoteConnection("env", "Machine is unreachable"));
  await act(async () => vi.advanceTimersByTimeAsync(60 * 60_000));

  expect(gitDiffStats).toHaveBeenCalledTimes(1);
});

it("starts a focused local checkout and a different remote machine while another queues", async () => {
  adoptRemoteMachineInventory([MACHINE, { ...MACHINE, id: "m2", environmentId: "env2" }]);
  const paths = Array.from({ length: 6 }, (_, index) => `${cwd}/${index}`);
  const local = `/local-stats-${serial}`;
  const other = remotePath("env2", "/other");
  const complete: ((stats: typeof STATS) => void)[] = [];
  gitDiffStats.mockImplementation(() => new Promise((resolve) => complete.push(resolve)));
  function Overview() {
    useProjectsDiffStats([...paths, other], true);
    useProjectDiffStats(local, true);
    return null;
  }
  await act(async () => root.render(createElement(Overview)));
  const started = gitDiffStats.mock.calls.map(([path]) => path);
  await act(async () => root.render(null));
  await act(async () => complete.forEach((resolve) => resolve(STATS)));
  expect(started).toEqual([...paths.slice(0, 4), other, local]);
  expect(gitDiffStats).toHaveBeenCalledTimes(6);
});

it("retries a queued Git change on reconnect even when its cached counts are recent", async () => {
  const paths = Array.from({ length: 4 }, (_, index) => `${cwd}-busy-${index}`);
  const finish: ((stats: typeof STATS) => void)[] = [];
  gitDiffStats.mockImplementation((path: string) =>
    path === cwd
      ? Promise.resolve({ ...STATS, deletions: 7 })
      : new Promise((resolve) => finish.push(resolve)),
  );
  applyProjectDiffStats(cwd, STATS);
  function Overview() {
    useProjectsDiffStats(paths, true);
    return useProjectDiffStats(cwd, true)?.deletions;
  }
  await act(async () => root.render(createElement(Overview)));
  expect(container.textContent).toBe("3");
  await act(async () => notifyGitChanged(cwd, "index"));
  expect(gitDiffStats.mock.calls.map(([path]) => path)).toEqual(paths);
  await act(async () => {
    recordRemoteConnection("env", "Machine is unreachable");
    finish.splice(0).forEach((resolve) => resolve(STATS));
  });
  expect(gitDiffStats).toHaveBeenCalledTimes(4);
  await act(async () => recordRemoteConnection("env"));
  expect(gitDiffStats.mock.calls.map(([path]) => path)).toEqual([...paths, cwd]);
  expect(container.textContent).toBe("7");
});
