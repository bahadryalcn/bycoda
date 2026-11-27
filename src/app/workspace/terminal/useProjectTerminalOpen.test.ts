// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { ProjectTerminalDock } from "../../../features/projects/model/projectTerminal";
import { useProjectTerminalOpen, type ProjectTerminalOpenDeps } from "./useProjectTerminalOpen";

vi.mock("../../../features/connections/public/connections", () => ({
  useRemoteMachines: () => ({
    machines: [
      { id: "other-ssh", environmentId: "other", ssh: {} },
      { id: "url-connection", environmentId: "url-only" },
      { id: "saved-ssh", environmentId: "owner", ssh: {} },
    ],
  }),
}));

it("opens remote shells over saved SSH, or on the project's Host without SSH", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  const projectCwdRef = { current: "remote://owner/G:/project" };
  const terminalCwd = "remote://owner/G:/worktree with spaces";
  let docks: ProjectTerminalDock[] = [];
  let actions!: ReturnType<typeof useProjectTerminalOpen>;
  function Consumer() {
    actions = useProjectTerminalOpen({
      projectCwd: projectCwdRef.current,
      projectCwdRef,
      terminalCwd,
      setComposerFocused: () => {},
      dock: {
        setProjectTerminals: (
          update: (previous: ProjectTerminalDock[]) => ProjectTerminalDock[],
        ) => {
          docks = update(docks);
        },
        setProjectTerminalFocused: () => {},
        lastDockSideRef: { current: "bottom" },
        projectTerminalsRef: { current: docks },
      },
    } as unknown as ProjectTerminalOpenDeps);
    return null;
  }
  try {
    await act(async () => root.render(createElement(Consumer)));
    expect(actions.remoteTerminalAvailable).toBe(true);
    expect(actions.openProjectTerminal("remote://other/G:/project")).toBe(false);
    expect(docks).toEqual([]);
    actions.onNewTerminal();
    const first = docks[0].pane.activeFileId;
    expect(docks[0].sshShells?.[first]).toEqual({
      connectionId: "saved-ssh",
      project: { environmentId: "owner", cwd: "G:/worktree with spaces" },
    });
    actions.onSplitProjectTerminal(first);
    const second = docks[0].pane.activeFileId;
    expect(docks[0].sshShells?.[second]).toEqual(docks[0].sshShells?.[first]);
    expect(docks[0].splitGroups).toEqual([[first, second]]);
    expect(docks[0].hostShells).toBeUndefined();
    projectCwdRef.current = "remote://url-only/G:/project";
    await act(async () => root.render(createElement(Consumer)));
    expect(actions.remoteTerminalAvailable).toBe(true);
    expect(actions.openProjectTerminal("remote://owner/G:/project")).toBe(false);
    expect(actions.openProjectTerminal(projectCwdRef.current, "pwsh")).toBe(false);
    expect(docks).toHaveLength(1);
    expect(actions.openProjectTerminal(projectCwdRef.current)).toBe(true);
    const hostDock = docks[1];
    const hosted = hostDock.pane.activeFileId;
    expect(hostDock.sshShells).toBeUndefined();
    expect(hostDock.hostShells?.[hosted]).toEqual({ projectCwd: "remote://url-only/G:/project" });
    actions.onSplitProjectTerminal(hosted);
    const hostedSplit = docks[1].pane.activeFileId;
    expect(docks[1].hostShells?.[hostedSplit]).toEqual(docks[1].hostShells?.[hosted]);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
