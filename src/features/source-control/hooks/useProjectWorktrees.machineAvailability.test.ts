// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { listWorktrees } = vi.hoisted(() => ({ listWorktrees: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
vi.mock("../model/worktrees", () => ({ listWorktrees }));

import { adoptRemoteMachineInventory } from "../../connections/model/connections";
import { recordRemoteConnection, resetRemoteHealth } from "../../connections/model/remoteHealth";
import { remotePath } from "../../connections/model/remoteProjects";
import { useProjectWorktrees } from "./useProjectWorktrees";

const MACHINE = { id: "m1", name: "Desk", endpoint: "http://desk", environmentId: "env" };
const CWD = remotePath("env", "G:/Projects/worktrees");
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetRemoteHealth();
  adoptRemoteMachineInventory([MACHINE]);
  listWorktrees.mockReset().mockResolvedValue({ worktrees: [] });
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

it("does not refresh the worktrees of an offline machine", async () => {
  let shown: ReturnType<typeof useProjectWorktrees> | undefined;
  const Probe = () => {
    shown = useProjectWorktrees(CWD);
    return null;
  };
  await act(async () => root.render(createElement(Probe)));
  expect(listWorktrees).toHaveBeenCalledTimes(1);

  await act(async () => recordRemoteConnection("env", "Machine is unreachable"));
  await act(async () => void shown?.refresh());

  expect(listWorktrees).toHaveBeenCalledTimes(1);
});
