// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
  useProjectTerminalDockActions,
  type ProjectTerminalDockActionDeps,
} from "./useProjectTerminalDockActions";
import {
  newEditorPane,
  newTab,
  newTerminalFile,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";
import type { ProjectTerminalDock } from "../../../features/projects/model/projectTerminal";
import {
  confirmCloseTerminal,
  confirmCloseTerminals,
} from "../../../features/terminal/model/terminalClose";
vi.mock("../../../features/terminal/model/terminalClose", () => ({
  confirmCloseTerminal: vi.fn(),
  confirmCloseTerminals: vi.fn(),
}));

it("closes the original project's terminal after switching projects during confirmation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const a = newTerminalFile("/a"),
    b = newTerminalFile("/b");
  const ref = {
    current: [
      { projectPath: "/a", pane: newEditorPane(a), side: "bottom", size: 200, open: true },
      { projectPath: "/b", pane: newEditorPane(b), side: "bottom", size: 200, open: true },
    ] as ProjectTerminalDock[],
  };
  const projectCwdRef = { current: "/a" };
  let finish!: (value: boolean) => void;
  vi.mocked(confirmCloseTerminal).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let actions!: ReturnType<typeof useProjectTerminalDockActions>;
  function Consumer() {
    actions = useProjectTerminalDockActions({
      projectCwdRef,
      dock: {
        projectTerminalsRef: ref,
        setProjectTerminals: (update: (value: ProjectTerminalDock[]) => ProjectTerminalDock[]) => {
          ref.current = update(ref.current);
        },
      },
    } as unknown as ProjectTerminalDockActionDeps);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Consumer)));
    act(() => actions.onCloseProjectTerminal(a.id));
    // /a has one terminal, so closing it also closes the panel and asks even when idle.
    expect(confirmCloseTerminal).toHaveBeenCalledWith(a, { last: true });
    projectCwdRef.current = "/b";
    await act(async () => finish(true));
    expect(ref.current.map((dock) => dock.projectPath)).toEqual(["/b"]);
    expect(ref.current[0].pane.files[0].id).toBe(b.id);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("closes every terminal and the panel, keeping one opened during confirmation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const one = newTerminalFile("/a"),
    two = newTerminalFile("/a"),
    late = newTerminalFile("/a");
  const pane = { ...newEditorPane(one), files: [one, two] };
  const ref = {
    current: [
      { projectPath: "/a", pane, side: "bottom", size: 200, open: true },
    ] as ProjectTerminalDock[],
  };
  let finish!: (value: boolean) => void;
  vi.mocked(confirmCloseTerminals).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let actions!: ReturnType<typeof useProjectTerminalDockActions>;
  function Consumer() {
    actions = useProjectTerminalDockActions({
      projectCwdRef: { current: "/a" },
      dock: {
        projectTerminalsRef: ref,
        setProjectTerminals: (update: (value: ProjectTerminalDock[]) => ProjectTerminalDock[]) => {
          ref.current = update(ref.current);
        },
      },
    } as unknown as ProjectTerminalDockActionDeps);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Consumer)));
    act(() => actions.onCloseProjectTerminals());
    expect(confirmCloseTerminals).toHaveBeenLastCalledWith([one, two]);
    const dock = ref.current[0];
    ref.current = [{ ...dock, pane: { ...dock.pane, files: [one, two, late] } }];
    await act(async () => finish(true));
    expect(ref.current[0].pane.files.map((file) => file.id)).toEqual([late.id]);

    act(() => actions.onCloseProjectTerminals());
    await act(async () => finish(true));
    expect(ref.current).toEqual([]);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("terminal meta events leave tabs untouched unless a terminal really changed", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const terminal = newTerminalFile("/a");
  const plain = newTab("s1");
  const withTerminal = { ...newTab("s2"), terminalPanes: [newEditorPane(terminal)] };
  const tabs = [plain, withTerminal];
  const setTabs = vi.fn();
  let actions!: ReturnType<typeof useProjectTerminalDockActions>;
  function Consumer() {
    actions = useProjectTerminalDockActions({
      projectCwdRef: { current: "/a" },
      setTabs,
      dock: { setProjectTerminals: vi.fn() },
    } as unknown as ProjectTerminalDockActionDeps);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    act(() => root.render(createElement(Consumer)));
    const run = () => {
      const update = setTabs.mock.calls.at(-1)![0] as (previous: WorkspaceTab[]) => WorkspaceTab[];
      return update(tabs);
    };
    act(() => actions.onTerminalMetaChange(terminal.id, { cwd: "/a" }));
    expect(run()).toBe(tabs);
    act(() => actions.onTerminalMetaChange("missing", { cwd: "/z" }));
    expect(run()).toBe(tabs);
    act(() => actions.onTerminalMetaChange(terminal.id, { cwd: "/b" }));
    const changed = run();
    expect(changed).not.toBe(tabs);
    expect(changed[0]).toBe(plain);
    expect(changed[1]).not.toBe(withTerminal);
    expect(changed[1].terminalPanes?.[0].files[0].cwd).toBe("/b");
  } finally {
    act(() => root.unmount());
  }
});
