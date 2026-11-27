// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { gitBranches } = vi.hoisted(() => ({ gitBranches: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
vi.mock("../../../platform/tauri/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/fs")>()),
  gitBranches,
  subscribeGitChanged: () => () => undefined,
}));
vi.mock("../hooks/useProjectWorktrees", () => ({
  useProjectWorktrees: () => ({ data: undefined, refresh: async () => true }),
}));

import { adoptRemoteMachineInventory } from "../../connections/model/connections";
import { recordRemoteConnection, resetRemoteHealth } from "../../connections/model/remoteHealth";
import { remotePath } from "../../connections/model/remoteProjects";
import { BranchPicker } from "./BranchPicker";

const MACHINE = { id: "m1", name: "Desk", endpoint: "http://desk", environmentId: "env" };
const SECOND = { id: "m2", name: "Lab", endpoint: "http://lab", environmentId: "env2" };
const CWD = remotePath("env", "G:/Projects/app");
const CWD3 = remotePath("env", "G:/Projects/failing");
const CWD4 = remotePath("env", "G:/Projects/plain");
const CWD2 = remotePath("env2", "G:/Projects/other");
const repo = { current: "feature", detached: false, branches: [] };
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetRemoteHealth();
  adoptRemoteMachineInventory([MACHINE, SECOND]);
  gitBranches.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  adoptRemoteMachineInventory([]);
  vi.unstubAllGlobals();
});

const trigger = () => container.querySelector("button");
const render = (cwd: string) =>
  act(async () => root.render(createElement(BranchPicker, { cwd, enabled: true })));

it("keeps the last known branch, unverified, while the machine is unreachable, then recovers", async () => {
  gitBranches.mockResolvedValue(repo);
  await render(CWD);
  expect(trigger()?.textContent).toContain("feature");

  await act(async () => recordRemoteConnection("env", "Machine is unreachable"));
  expect(trigger()?.textContent).toContain("feature");
  expect(trigger()?.textContent).not.toContain("No repo");
  expect(trigger()?.disabled).toBe(true);

  gitBranches.mockResolvedValue({ ...repo, current: "main" });
  const { notifyRemoteRecovered } = await import("../../connections/model/remoteHealth");
  await act(async () => notifyRemoteRecovered("env"));
  await act(async () => undefined);
  expect(trigger()?.textContent).toContain("main");
  expect(trigger()?.disabled).toBe(false);
});

it("shows Unavailable, not No repo, when the machine is unreachable and nothing was cached", async () => {
  await act(async () => recordRemoteConnection("env2", "Machine is unreachable"));
  await render(CWD2);
  expect(trigger()?.textContent).toContain("Unavailable");
  expect(trigger()?.textContent).not.toContain("No repo");
});

it("shows Unavailable when a remote read fails instead of reporting no repository", async () => {
  gitBranches.mockRejectedValue(new Error("boom"));
  await render(CWD3);
  expect(trigger()?.textContent).toContain("Unavailable");
  expect(trigger()?.textContent).not.toContain("No repo");
});

it("still says No repo when a successful read reports no repository", async () => {
  gitBranches.mockResolvedValue(null);
  await render(CWD4);
  expect(trigger()?.textContent).toContain("No repo");
});
