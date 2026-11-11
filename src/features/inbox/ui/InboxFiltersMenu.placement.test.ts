// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { InboxFiltersMenu } from "./InboxFiltersMenu";
import { DEFAULT_INBOX_FILTERS } from "../model/inboxFilters";

it("opens a repository flyout sideways and keeps the parent open after selection and Escape", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("innerWidth", 800);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onChange = vi.fn();
  const onClose = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(InboxFiltersMenu, {
          x: 16,
          y: 100,
          source: "github",
          filters: DEFAULT_INBOX_FILTERS,
          projects: [{ path: "github:acme/app", name: "acme/app", logoPath: null }],
          linearProjects: [],
          linearTeams: [],
          hiddenLinearTeamIds: [],
          jiraProjects: [],
          hiddenJiraProjectIds: [],
          onChange,
          onClose,
          onLinearTeamsChange: vi.fn(),
          onJiraProjectsChange: vi.fn(),
        }),
      ),
    );
    const parent = document.querySelector('[aria-label="Filter inbox"]')!;
    const trigger = parent.querySelector<HTMLButtonElement>(
      'button[aria-label^="Local repositories:"]',
    )!;
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(new DOMRect(24, 380, 210, 28));
    await act(async () => trigger.click());
    const child = document.querySelector<HTMLElement>('[aria-label="Local repositories options"]')!;
    expect(child.dataset.popoverSide).toBe("right");
    const option = child.querySelector<HTMLButtonElement>('[role="option"]')!;
    await act(async () => option.click());
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ hiddenProjects: ["github:acme/app"] }),
    );
    expect(document.querySelector('[aria-label="Filter inbox"]')).toBe(parent);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () =>
      child
        .querySelector("input")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(document.querySelector('[aria-label="Local repositories options"]')).toBeNull();
    expect(document.querySelector('[aria-label="Filter inbox"]')).toBe(parent);
    expect(document.activeElement).toBe(trigger);
    expect(onClose).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
