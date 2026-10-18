// @vitest-environment happy-dom
import { act, createElement, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useRailNavigation, type SettingsReturnView } from "./useRailNavigation";

it("backs out of Servers and Settings and restores both through Forward without changing the project", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onVisitBack = vi.fn();
  const onVisitForward = vi.fn();
  let navigation!: ReturnType<typeof useRailNavigation>;
  let openSettings!: () => void;
  let current!: { servers: boolean; settings: boolean };
  function Harness() {
    const [servers, setServers] = useState(true);
    const [settings, setSettings] = useState(false);
    const [search, setSearch] = useState(false);
    const [inbox, setInbox] = useState(false);
    const [notes, setNotes] = useState(false);
    const [automations, setAutomations] = useState(false);
    const settingsReturnViewRef = useRef<SettingsReturnView>({
      servers: true,
      search: false,
      inbox: false,
      notes: false,
      automations: false,
    });
    current = { servers, settings };
    openSettings = () => {
      setSettings(true);
      setServers(false);
    };
    navigation = useRailNavigation({
      activeTabId: "retained-session",
      projectCwd: "/retained-project",
      settingsOpen: settings,
      serversViewOpen: servers,
      searchViewOpen: search,
      inboxViewOpen: inbox,
      notesViewOpen: notes,
      automationsViewOpen: automations,
      setSettingsOpen: setSettings,
      setServersViewOpen: setServers,
      setSearchViewOpen: setSearch,
      setInboxViewOpen: setInbox,
      setNotesViewOpen: setNotes,
      setAutomationsViewOpen: setAutomations,
      settingsReturnViewRef,
      onCloseSettings: () => {
        setSettings(false);
        setServers(true);
      },
      onVisitBack,
      onVisitForward,
    });
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(() => root.render(createElement(Harness)));
    await act(() => navigation.onRailBack());
    expect(current).toEqual({ servers: false, settings: false });
    expect(navigation.surfaceForward.canForward).toBe(true);
    await act(() => navigation.onRailForward());
    expect(current.servers).toBe(true);
    await act(() => openSettings());
    await act(() => navigation.onRailBack());
    expect(current).toEqual({ servers: true, settings: false });
    await act(() => navigation.onRailForward());
    expect(current).toEqual({ servers: false, settings: true });
    expect(onVisitBack).not.toHaveBeenCalled();
    expect(onVisitForward).not.toHaveBeenCalled();
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
