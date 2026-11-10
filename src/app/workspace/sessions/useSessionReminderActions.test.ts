// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { newSession } from "../../../features/sessions/model/session";

const reminders = vi.hoisted(() => ({
  open: null as null | ((sessionId: string) => Promise<void>),
}));
vi.mock("../../../features/notifications/hooks/useSessionReminders", () => ({
  useSessionReminders: (open: (sessionId: string) => Promise<void>) => {
    reminders.open = open;
    return {};
  },
}));
vi.mock("../../../features/sessions/data/sessionStore", () => ({ upsertSession: vi.fn() }));
vi.mock("../../../features/projects/model/recents", () => ({
  rememberProject: vi.fn(async () => []),
}));
import { useSessionReminderActions } from "./useSessionReminderActions";

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));

async function mount(openSession: (id: string) => Promise<boolean>, found: boolean) {
  const session = newSession("codex", "G:/project");
  const setters = {
    setSearchViewOpen: vi.fn(),
    setInboxViewOpen: vi.fn(),
    setNotesViewOpen: vi.fn(),
    setAutomationsViewOpen: vi.fn(),
    setSettingsOpen: vi.fn(),
    setFilePickerOpen: vi.fn(),
    setSidebarTab: vi.fn(),
    setProjectCwd: vi.fn(),
    setRecents: vi.fn(),
  };
  function Fixture() {
    useSessionReminderActions({
      sessions: [],
      sessionsRef: { current: [] },
      ensureOpenSession: async () => (found ? session : null),
      openSession,
      ...setters,
    });
    return null;
  }
  await act(async () => createRoot(document.createElement("div")).render(createElement(Fixture)));
  return { session, setters };
}

it("opens a due reminder's conversation through the shared opener, then resets the views", async () => {
  const openSession = vi.fn(async () => true);
  const { session, setters } = await mount(openSession, true);
  await reminders.open!(session.id);
  expect(openSession).toHaveBeenCalledWith(session.id);
  expect(setters.setSidebarTab).toHaveBeenCalledWith("sessions", "G:/project");
  expect(setters.setSettingsOpen).toHaveBeenCalledWith(false);
});

it("reports a reminder whose conversation cannot be opened", async () => {
  const { setters } = await mount(
    vi.fn(async () => false),
    true,
  );
  await expect(reminders.open!("locked-or-gone")).rejects.toThrow("no longer available");
  expect(setters.setSidebarTab).not.toHaveBeenCalled();
});
