// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { ProjectTerminalDock } from "../../../features/projects/model/projectTerminal";
import { useDockGridSizing } from "./useDockGridSizing";
import type { ProjectTerminalDockState } from "./useProjectTerminalDockState";

it("drops the dock row when the dock hides, even after a drag that never ended", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const dock = {
    projectPath: "/project",
    side: "bottom",
    size: 220,
    open: true,
    pane: { id: "pane", activeFileId: null, files: [] },
  } as unknown as ProjectTerminalDock;
  const projectTerminalsRef = { current: [dock] };
  let sizing!: ReturnType<typeof useDockGridSizing>;
  function Grid({ visible }: { visible: boolean }) {
    sizing = useDockGridSizing({
      dock: {
        projectTerminalsRef,
        currentProjectDock: visible ? dock : { ...dock, open: false },
        dockVisible: visible,
      } as unknown as ProjectTerminalDockState,
      projectCwdRef: { current: "/project" },
      onProjectTerminalSize: () => {},
    });
    return createElement("div", { ref: sizing.dockGridRef });
  }
  try {
    await act(async () => root.render(createElement(Grid, { visible: true })));
    const grid = host.firstElementChild as HTMLElement;
    expect(grid.style.gridTemplateRows).toBe("minmax(0, 1fr) 220px");
    // A drag paints a size and is never committed (its end was lost).
    act(() => sizing.paintDockSize(300));
    expect(grid.style.gridTemplateRows).toBe("minmax(0, 1fr) 300px");
    await act(async () => root.render(createElement(Grid, { visible: false })));
    expect(grid.style.gridTemplateRows).toBe("minmax(0, 1fr)");
    expect(grid.style.gridTemplateAreas).toBe('"main"');
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
