// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { InboxFiltersMenu } from "./InboxFiltersMenu";
import { DEFAULT_INBOX_FILTERS } from "../model/inboxFilters";
vi.mock("../../../shared/ui/Popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => children,
}));
it("Atanan öğelerde de uzak proje seçimi görünür ve yalnız bu filtre varken temizlenir", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const change = vi.fn();
  const props = {
    x: 0,
    y: 0,
    projects: [],
    linearProjects: [],
    linearTeams: [],
    hiddenLinearTeamIds: [],
    jiraProjects: [],
    hiddenJiraProjectIds: [],
    source: "gitlab" as const,
    filters: { ...DEFAULT_INBOX_FILTERS, assignedToMe: true },
    onChange: vi.fn(),
    onLinearTeamsChange: vi.fn(),
    onJiraProjectsChange: vi.fn(),
    onClose: vi.fn(),
    codeHostProjects: [{ id: "12", path: "group/repo", name: "Remote project" }],
    hiddenCodeHostProjects: ["12", "no-longer-loaded"],
    onCodeHostProjectsChange: change,
  };
  try {
    await act(async () => root.render(createElement(InboxFiltersMenu, props)));
    const picker = host.querySelector<HTMLButtonElement>('button[aria-label^="Projects:"]')!;
    expect(picker).toBeTruthy();
    await act(async () => picker.click());
    const project = host.querySelector<HTMLButtonElement>('[role="option"][data-value="12"]')!;
    expect(project).toBeTruthy();
    await act(async () => project.click());
    expect(change).toHaveBeenLastCalledWith(["no-longer-loaded"]);
    await act(async () =>
      root.render(createElement(InboxFiltersMenu, { ...props, filters: DEFAULT_INBOX_FILTERS })),
    );
    const clear = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Clear filters"),
    );
    expect(clear).toBeDefined();
    act(() => clear!.click());
    expect(change).toHaveBeenLastCalledWith([]);
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
