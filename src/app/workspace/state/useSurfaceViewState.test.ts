// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useSurfaceBoardFlags } from "./useSurfaceViewState";
import { crewsPageOpen, setCrewsPageOpen } from "../../../features/crews/model/crewsPage";

afterEach(() => setCrewsPageOpen(false));

it("counts the Crews page as a servers-class view that closing Servers also closes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let flags!: ReturnType<typeof useSurfaceBoardFlags>;
  function Probe() {
    flags = useSurfaceBoardFlags({ toolWindow: null });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Probe)));
    expect(flags.serversViewOpen).toBe(false);
    await act(async () => setCrewsPageOpen(true));
    expect(flags.serversViewOpen).toBe(true);
    await act(async () => flags.setServersViewOpen(false));
    expect(crewsPageOpen()).toBe(false);
    expect(flags.serversViewOpen).toBe(false);
    await act(async () => flags.setServersViewOpen(true));
    expect(flags.serversViewOpen).toBe(true);
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
