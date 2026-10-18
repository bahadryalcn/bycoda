// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useSettingsSurfaceActions, type SettingsSurfaceActionsDeps } from "./useSettingsSurface";

vi.mock("../../../features/connections/model/connections", () => ({
  OPEN_CONNECTIONS_EVENT: "bycoda:open-connections",
}));

it("returns to Servers after opening and changing settings sections", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const deps: SettingsSurfaceActionsDeps = {
    setSettingsOpen: vi.fn(),
    setSettingsSection: vi.fn(),
    setSettingsAnchor: vi.fn(),
    setNotificationProjectPath: vi.fn(),
    setNotificationSettingsRequest: vi.fn(),
    setFilePickerOpen: vi.fn(),
    setSearchViewOpen: vi.fn(),
    setInboxViewOpen: vi.fn(),
    setNotesViewOpen: vi.fn(),
    setAutomationsViewOpen: vi.fn(),
    setServersViewOpen: vi.fn(),
    settingsOpenRef: { current: false },
    searchViewOpenRef: { current: false },
    inboxViewOpenRef: { current: false },
    notesViewOpenRef: { current: false },
    automationsViewOpenRef: { current: false },
    serversViewOpenRef: { current: true },
  };
  let actions!: ReturnType<typeof useSettingsSurfaceActions>;
  function Harness() {
    actions = useSettingsSurfaceActions(deps);
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    act(() => root.render(createElement(Harness)));
    act(() => actions.openSettings("connections"));
    expect(deps.setServersViewOpen).toHaveBeenLastCalledWith(false);
    deps.settingsOpenRef.current = true;
    deps.serversViewOpenRef!.current = false;
    act(() => actions.openSettings("appearance"));
    act(() => actions.onCloseSettings());
    expect(deps.setServersViewOpen).toHaveBeenLastCalledWith(true);
    expect(deps.setSearchViewOpen).toHaveBeenLastCalledWith(false);
    expect(deps.setSettingsOpen).toHaveBeenLastCalledWith(false);
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
