// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { invokeWorkspace, subscribeGitChanged } = vi.hoisted(() => ({
  invokeWorkspace: vi.fn(),
  subscribeGitChanged: vi.fn((_listener: () => void) => () => undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
vi.mock("../../../platform/tauri/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/fs")>()),
  invokeWorkspace,
  subscribeGitChanged,
}));

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
  invokeWorkspace.mockReset().mockResolvedValue({ worktrees: [] });
  subscribeGitChanged.mockClear();
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
  expect(invokeWorkspace).toHaveBeenCalledTimes(1);

  await act(async () => recordRemoteConnection("env", "Machine is unreachable"));
  await act(async () => void shown?.refresh());

  expect(invokeWorkspace).toHaveBeenCalledTimes(1);
});

it("sends the background flag for focus and Git events and omits it for explicit loads", async () => {
  let shown: ReturnType<typeof useProjectWorktrees> | undefined;
  const Probe = () => {
    shown = useProjectWorktrees(CWD);
    return null;
  };
  await act(async () => root.render(createElement(Probe)));
  expect(invokeWorkspace).toHaveBeenLastCalledWith("git_worktrees", { cwd: CWD });

  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(invokeWorkspace).toHaveBeenLastCalledWith("git_worktrees", { cwd: CWD, background: true });

  await act(async () => {
    const [onGitChanged] = subscribeGitChanged.mock.calls[0];
    onGitChanged();
  });
  expect(invokeWorkspace).toHaveBeenCalledTimes(3);
  expect(invokeWorkspace).toHaveBeenLastCalledWith("git_worktrees", { cwd: CWD, background: true });

  await act(async () => {
    await shown?.refresh();
  });
  expect(invokeWorkspace).toHaveBeenLastCalledWith("git_worktrees", { cwd: CWD });
});

it("starts manual refresh during a focus load and ignores the older response", async () => {
  let shown: ReturnType<typeof useProjectWorktrees> | undefined;
  const Probe = () => {
    shown = useProjectWorktrees(CWD);
    return null;
  };
  await act(async () => root.render(createElement(Probe)));
  const older = Promise.withResolvers<{ worktrees: []; defaultRoot: string }>();
  invokeWorkspace.mockReturnValueOnce(older.promise);
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  invokeWorkspace.mockResolvedValueOnce({ worktrees: [], defaultRoot: "new" });
  let refresh: Promise<boolean> | undefined;
  await act(async () => {
    refresh = shown?.refresh();
  });
  expect(invokeWorkspace).toHaveBeenCalledTimes(3);
  expect(invokeWorkspace).toHaveBeenLastCalledWith("git_worktrees", { cwd: CWD });
  await expect(refresh).resolves.toBe(true);
  expect(shown?.data?.defaultRoot).toBe("new");
  await act(async () => older.resolve({ worktrees: [], defaultRoot: "old" }));
  expect(shown?.data?.defaultRoot).toBe("new");
  expect(shown?.loading).toBe(false);
});
