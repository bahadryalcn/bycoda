// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSurfaceOpeners, type SurfaceOpenersDeps } from "./useSurfaceOpeners";
import { routeWindowDestination } from "../../model/windowNavigation";
import { loadNotesEnabled } from "../../../features/settings/model/settings";
import {
  requestOpenNoteLibrary,
  takeNoteLibraryTarget,
} from "../../../features/notes/noteNavigation";

vi.mock("../../model/windowNavigation", () => ({
  routeWindowDestination: vi.fn().mockResolvedValue(true),
}));
vi.mock("../../../features/settings/model/settings", () => ({
  loadNotesEnabled: vi.fn(() => true),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadNotesEnabled).mockReturnValue(true);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => vi.unstubAllGlobals());

it("opens tools locally even when another window could handle them", async () => {
  const setters = {
    setFilePickerOpen: vi.fn(),
    setSettingsOpen: vi.fn(),
    setSearchViewOpen: vi.fn(),
    setInboxViewOpen: vi.fn(),
    setNotesViewOpen: vi.fn(),
    setAutomationsViewOpen: vi.fn(),
    setTaskBoardShown: vi.fn(),
    setSocialBoardShown: vi.fn(),
    setPullRequestsOnly: vi.fn(),
    setServersViewOpen: vi.fn(),
  } satisfies Omit<SurfaceOpenersDeps, "projectCwd">;
  let actions!: ReturnType<typeof useSurfaceOpeners>;
  function Workspace() {
    actions = useSurfaceOpeners({ projectCwd: "/repo", ...setters });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(() => root.render(createElement(Workspace)));
    for (const [open, setter] of [
      ["onOpenNotes", "setNotesViewOpen"],
      ["onOpenInbox", "setInboxViewOpen"],
      ["onOpenAutomations", "setAutomationsViewOpen"],
      ["onOpenTasks", "setTaskBoardShown"],
    ] as const) {
      Object.values(setters).forEach((setter) => setter.mockClear());
      await act(async () => {
        await actions[open]();
      });
      expect(setters[setter]).toHaveBeenLastCalledWith(true);
      expect(setters.setFilePickerOpen).toHaveBeenLastCalledWith(false);
      expect(setters.setSettingsOpen).toHaveBeenLastCalledWith(false);
      expect(setters.setSearchViewOpen).toHaveBeenLastCalledWith(false);
      expect(setters.setServersViewOpen).toHaveBeenLastCalledWith(false);
      if (open === "onOpenTasks") {
        expect(setters.setAutomationsViewOpen).toHaveBeenLastCalledWith(true);
        expect(setters.setSocialBoardShown).toHaveBeenLastCalledWith(false);
      }
      if (open === "onOpenAutomations") {
        expect(setters.setTaskBoardShown).toHaveBeenLastCalledWith(false);
        expect(setters.setSocialBoardShown).toHaveBeenLastCalledWith(false);
      }
      if (open === "onOpenInbox")
        expect(setters.setPullRequestsOnly).toHaveBeenLastCalledWith(false);
    }
    Object.values(setters).forEach((setter) => setter.mockClear());
    await act(async () => requestOpenNoteLibrary({ id: "panel-note", cwd: "/repo" }));
    expect(setters.setNotesViewOpen).toHaveBeenLastCalledWith(true);
    expect(takeNoteLibraryTarget()).toEqual({ id: "panel-note", cwd: "/repo" });
    vi.mocked(loadNotesEnabled).mockReturnValue(false);
    Object.values(setters).forEach((setter) => setter.mockClear());
    await act(async () => actions.onOpenNotes());
    expect(Object.values(setters).every((setter) => setter.mock.calls.length === 0)).toBe(true);
    await act(async () => actions.onOpenInbox(true));
    expect(setters.setInboxViewOpen).toHaveBeenLastCalledWith(true);
    expect(routeWindowDestination).not.toHaveBeenCalled();
  } finally {
    await act(() => root.unmount());
  }
});
