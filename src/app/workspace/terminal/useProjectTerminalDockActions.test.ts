// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
  useProjectTerminalDockActions,
  type ProjectTerminalDockActionDeps,
} from "./useProjectTerminalDockActions";
import { newEditorPane, newTerminalFile } from "../../../features/workspace/model/layout";
import type { ProjectTerminalDock } from "../../../features/projects/model/projectTerminal";
import { confirmCloseTerminal } from "../../../features/terminal/model/terminalClose";
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
    projectCwdRef.current = "/b";
    await act(async () => finish(true));
    expect(ref.current.map((dock) => dock.projectPath)).toEqual(["/b"]);
    expect(ref.current[0].pane.files[0].id).toBe(b.id);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
