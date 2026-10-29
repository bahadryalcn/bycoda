// @vitest-environment happy-dom
import { StrictMode, act, createElement, useRef, useState, type Dispatch, type SetStateAction, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWindowChromeActions, type WindowChromeActions } from "./useWindowChromeActions";

const appearance = vi.hoisted(() => ({
  saveProjectRailOpen: vi.fn(),
  saveSessionSidebarOpen: vi.fn(),
}));

vi.mock("../../../features/settings/model/appearance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../features/settings/model/appearance")>()),
  saveProjectRailOpen: appearance.saveProjectRailOpen,
  saveSessionSidebarOpen: appearance.saveSessionSidebarOpen,
}));

type Snapshot = {
  actions: WindowChromeActions;
  projectRailOpen: boolean;
  sessionSidebarOpen: boolean;
};

let root: Root | undefined;
let container: HTMLDivElement;
let latest: Snapshot;

function Harness({ initialRail, initialSidebar }: { initialRail: boolean; initialSidebar: boolean }) {
  const [projectRailOpen, setProjectRailOpen] = useState(initialRail);
  const [sessionSidebarOpen, setSessionSidebarOpen] = useState(initialSidebar);
  const noop = () => undefined;
  const dirtyFilesRef = useRef(new Set<string>());
  const actions = useWindowChromeActions({
    projectRailOpen,
    sessionSidebarOpen,
    setProjectRailOpen,
    setSessionSidebarOpen,
    setSearchViewOpen: noop as Dispatch<SetStateAction<boolean>>,
    setInboxViewOpen: noop as Dispatch<SetStateAction<boolean>>,
    setNotesViewOpen: noop as Dispatch<SetStateAction<boolean>>,
    setAutomationsViewOpen: noop as Dispatch<SetStateAction<boolean>>,
    setFilePickerOpen: noop as Dispatch<SetStateAction<boolean>>,
    setFilePickerInitialQuery: noop as Dispatch<SetStateAction<string>>,
    setFilePickerResetToken: noop as Dispatch<SetStateAction<number>>,
    setSidebarTab: noop,
    setFilesSearchOpen: noop as Dispatch<SetStateAction<boolean>>,
    setSearchFocusToken: noop as Dispatch<SetStateAction<number>>,
    dirtyFilesRef,
  });
  const probed = { actions, projectRailOpen, sessionSidebarOpen };
  // Publish the committed value to the test after render, not during it.
  useLayoutEffect(() => {
    latest = probed;
  });
  return null;
}

function render(initialRail = false, initialSidebar = false) {
  act(() => {
    root!.render(
      createElement(StrictMode, null, createElement(Harness, { initialRail, initialSidebar })),
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  appearance.saveProjectRailOpen.mockReset();
  appearance.saveSessionSidebarOpen.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.unstubAllGlobals();
});

describe("useWindowChromeActions toggles under StrictMode", () => {
  it("renders with the initial state and does not save on mount", () => {
    render(true, false);

    expect(latest.projectRailOpen).toBe(true);
    expect(latest.sessionSidebarOpen).toBe(false);
    expect(appearance.saveProjectRailOpen).not.toHaveBeenCalled();
    expect(appearance.saveSessionSidebarOpen).not.toHaveBeenCalled();
  });

  it("flips the project rail once and saves exactly once", () => {
    render(false, false);

    act(() => latest.actions.onToggleProjectRail());

    expect(latest.projectRailOpen).toBe(true);
    expect(appearance.saveProjectRailOpen).toHaveBeenCalledTimes(1);
    expect(appearance.saveProjectRailOpen).toHaveBeenCalledWith(true);
    expect(appearance.saveSessionSidebarOpen).not.toHaveBeenCalled();
  });

  it("does not lose an update when the project rail is toggled twice in one act", () => {
    render(false, false);

    act(() => {
      latest.actions.onToggleProjectRail();
      latest.actions.onToggleProjectRail();
    });

    expect(latest.projectRailOpen).toBe(false);
    expect(appearance.saveProjectRailOpen.mock.calls).toEqual([[true], [false]]);
  });

  it("keeps toggling consistently across separate acts", () => {
    render(true, false);

    act(() => latest.actions.onToggleProjectRail());
    act(() => latest.actions.onToggleProjectRail());
    act(() => latest.actions.onToggleProjectRail());

    expect(latest.projectRailOpen).toBe(false);
    expect(appearance.saveProjectRailOpen.mock.calls).toEqual([[false], [true], [false]]);
  });

  it("onToggleSidebar is the project rail toggle", () => {
    render(false, false);

    act(() => latest.actions.onToggleSidebar());

    expect(latest.projectRailOpen).toBe(true);
    expect(appearance.saveProjectRailOpen).toHaveBeenCalledTimes(1);
    expect(appearance.saveProjectRailOpen).toHaveBeenCalledWith(true);
  });

  it("flips the session sidebar once and saves exactly once", () => {
    render(false, true);

    act(() => latest.actions.onToggleSessionSidebar());

    expect(latest.sessionSidebarOpen).toBe(false);
    expect(appearance.saveSessionSidebarOpen).toHaveBeenCalledTimes(1);
    expect(appearance.saveSessionSidebarOpen).toHaveBeenCalledWith(false);
    expect(appearance.saveProjectRailOpen).not.toHaveBeenCalled();
  });

  it("does not lose an update when the session sidebar is toggled twice in one act", () => {
    render(false, false);

    act(() => {
      latest.actions.onToggleSessionSidebar();
      latest.actions.onToggleSessionSidebar();
    });

    expect(latest.sessionSidebarOpen).toBe(false);
    expect(appearance.saveSessionSidebarOpen.mock.calls).toEqual([[true], [false]]);
  });

  it("keeps the two toggles independent when interleaved", () => {
    render(false, false);

    act(() => {
      latest.actions.onToggleProjectRail();
      latest.actions.onToggleSessionSidebar();
    });

    expect(latest.projectRailOpen).toBe(true);
    expect(latest.sessionSidebarOpen).toBe(true);
    expect(appearance.saveProjectRailOpen.mock.calls).toEqual([[true]]);
    expect(appearance.saveSessionSidebarOpen.mock.calls).toEqual([[true]]);
  });
});
