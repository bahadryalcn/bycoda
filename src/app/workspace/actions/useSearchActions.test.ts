// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useSearchActions, type SearchActionDeps } from "./useSearchActions";

it("preserves the current surface for dialog search and leaves it only on expand", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const deps: SearchActionDeps = {
    activeTabId: "tab",
    onCloseTab: vi.fn(),
    setFilePickerOpen: vi.fn(),
    setSettingsOpen: vi.fn(),
    setInboxViewOpen: vi.fn(),
    setNotesViewOpen: vi.fn(),
    setAutomationsViewOpen: vi.fn(),
    setServersViewOpen: vi.fn(),
    setSearchViewOpen: vi.fn(),
    setSearchViewFocusToken: vi.fn(),
  };
  let actions!: ReturnType<typeof useSearchActions>;
  function Harness() {
    actions = useSearchActions(deps);
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    act(() => root.render(createElement(Harness)));
    act(() => actions.onOpenSearch());
    expect(actions.searchDialogOpen).toBe(true);
    for (const setter of [
      deps.setSettingsOpen,
      deps.setInboxViewOpen,
      deps.setNotesViewOpen,
      deps.setAutomationsViewOpen,
      deps.setServersViewOpen,
    ]) {
      expect(setter).not.toHaveBeenCalled();
    }
    expect(deps.setSearchViewOpen).toHaveBeenLastCalledWith(false);
    act(() => actions.onExpandSearch());
    expect(actions.searchDialogOpen).toBe(false);
    expect(deps.setSearchViewOpen).toHaveBeenLastCalledWith(true);
    expect(deps.setServersViewOpen).toHaveBeenLastCalledWith(false);
    act(() => actions.onOpenSearch());
    act(() => actions.onLeaveSearch());
    expect(actions.searchDialogOpen).toBe(false);
    expect(deps.setSearchViewOpen).toHaveBeenLastCalledWith(false);
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
