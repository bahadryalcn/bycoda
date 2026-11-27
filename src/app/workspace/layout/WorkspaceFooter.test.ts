// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { setLanguagePreference } from "../../../shared/i18n";
import { WorkspaceFooter, type WorkspaceFooterProps } from "./WorkspaceFooter";

vi.mock("../../../features/projects/model/recents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../features/projects/model/recents")>()),
  canOpenTerminalIn: () => false,
}));
vi.mock("../../shell/UsageFooter", () => ({
  UsageFooter: ({ terminalUnavailableReason }: { terminalUnavailableReason?: string }) =>
    createElement("p", { "data-reason": "" }, terminalUnavailableReason),
}));
vi.mock("../../shell/WorkspaceControls", () => ({ WorkspaceControls: () => null }));
vi.mock("../../../features/terminal/ui/ProjectTerminalDock", () => ({
  ProjectTerminalDock: () => null,
}));
vi.mock("../../../features/sessions/ui/ApprovalToasts", () => ({ ApprovalToasts: () => null }));
vi.mock("../../../features/connections/public/LocalHostDownNotice", () => ({
  LocalHostVersionPrompt: () => null,
}));
vi.mock("../../../features/voice/ui/HiddenDictationIndicator", () => ({
  HiddenDictationIndicator: () => null,
}));
vi.mock("../../model/updater", () => ({ runUpdateFlow: vi.fn() }));

it("re-renders the memoized footer's translated strings after a language switch", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const props = {
    searchViewOpen: false,
    inboxViewOpen: false,
    notesViewOpen: false,
    automationsViewOpen: false,
    settingsOpen: false,
    projectCwd: "/remote/project",
  } as unknown as WorkspaceFooterProps;
  await act(async () => setLanguagePreference("en"));
  await act(async () => root.render(createElement(WorkspaceFooter, props)));
  const reason = () => container.querySelector("[data-reason]")?.textContent;
  expect(reason()).toContain("The terminal panel is available for local folders");
  // Same props object: only the locale changes, so only a subscription can refresh the text.
  await act(async () => setLanguagePreference("de"));
  expect(reason()).not.toContain("The terminal panel is available for local folders");
  await act(async () => setLanguagePreference("en"));
  await act(async () => root.unmount());
});

it.each([true, false])(
  "shows the development marker at the footer end only in dev (%s)",
  async (dev) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubEnv("DEV", dev);
    const container = document.createElement("div");
    const root = createRoot(container);
    const props = {
      searchViewOpen: false,
      inboxViewOpen: false,
      notesViewOpen: false,
      automationsViewOpen: false,
      settingsOpen: false,
      projectCwd: "/remote/project",
    } as unknown as WorkspaceFooterProps;
    await act(async () => root.render(createElement(WorkspaceFooter, props)));
    const marker = container.querySelector("[data-dev-mode-indicator]");
    if (dev) {
      expect(marker?.getAttribute("aria-label")).toBe("Development build");
      expect(marker?.closest("[data-workspace-footer]")).not.toBeNull();
    } else {
      expect(marker).toBeNull();
    }
    await act(async () => root.unmount());
    vi.unstubAllEnvs();
  },
);
