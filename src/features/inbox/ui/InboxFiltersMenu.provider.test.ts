// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { InboxFiltersMenu } from "./InboxFiltersMenu";
import { DEFAULT_INBOX_FILTERS } from "../model/inboxFilters";
vi.mock("../../../shared/ui/Popover", async () => ({
  ...(await vi.importActual<typeof import("../../../shared/ui/Popover")>(
    "../../../shared/ui/Popover",
  )),
  Popover: ({ children }: { children: ReactNode }) => children,
}));
it("shows Jira assignment and workflow selectors and clears every persisted filter", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const onChange = vi.fn();
  const filters = {
    ...DEFAULT_INBOX_FILTERS,
    jiraAssignees: ["ada"],
    jiraStatuses: ["Test approved"],
    jiraUnassigned: true,
  };
  try {
    await act(async () =>
      root.render(
        createElement(InboxFiltersMenu, {
          x: 0,
          y: 0,
          projects: [],
          linearProjects: [],
          linearTeams: [],
          hiddenLinearTeamIds: [],
          jiraProjects: [],
          hiddenJiraProjectIds: [],
          source: "jira",
          filters,
          onChange,
          onLinearTeamsChange: vi.fn(),
          onJiraProjectsChange: vi.fn(),
          onClose: vi.fn(),
        }),
      ),
    );
    expect(host.querySelector('button[aria-label^="Assignee:"]')).toBeTruthy();
    expect(host.querySelector('button[aria-label^="Board status:"]')).toBeTruthy();
    const unassigned =
      host.querySelector<HTMLInputElement>('input[type="checkbox"][aria-label="Unassigned"]') ??
      [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((input) =>
        input.closest("label")?.textContent?.includes("Unassigned"),
      );
    expect(unassigned).toBeTruthy();
    act(() => unassigned!.click());
    expect(onChange).toHaveBeenLastCalledWith({ ...filters, jiraUnassigned: false });
    const clear = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Clear filters"),
    );
    act(() => clear!.click());
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_INBOX_FILTERS);
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
it("shows the remote project selection for Assigned items too and clears it only while this filter applies", async () => {
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
