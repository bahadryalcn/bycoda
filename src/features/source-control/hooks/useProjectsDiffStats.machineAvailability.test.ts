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
import { useProjectsDiffStats } from "./useProjectDiffStats";

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
