// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ProjectRail } from "./ProjectRail";
import { SessionRecoveryControl } from "./SessionRecoveryControl";
import { workingProjectPaths } from "../../features/sessions/model/liveAgents";
import { readFileSync } from "node:fs";

it("keeps working decoration compositor-friendly and disables it with motion controls", () => {
  const css = readFileSync("src/styles/working-row.css", "utf8");
  expect(css).toMatch(
    /@keyframes project-row-working-pulse\s*\{[\s\S]*?opacity: 0;[\s\S]*?opacity: 1;/,
  );
  expect(css).not.toMatch(/animation:\s*project-row-working-sweep/);
  expect(css).toContain('[data-decorative-motion="off"]');
  expect(css).toContain('[data-window-focus="off"]');
  expect(css).toContain("prefers-reduced-motion: reduce");
  expect(css).toContain("data-performance-no-shimmer");
  // Appearance > Motion: "steady" stops only the pulse, "off" also drops the tint.
  expect(css).toMatch(/\[data-working-indicator="steady"\][^,{]*::after/);
  expect(css).toMatch(/\[data-working-indicator="off"\][^,{]*::before/);
  const tokens = readFileSync("src/styles/index.css", "utf8");
  expect(tokens).toMatch(/--ui-working-row-tint:[^;]*var\(--ui-working-row-color\)/);
  expect(tokens).toMatch(/--ui-working-row-sweep:[^;]*var\(--ui-working-row-strength\)/);
});

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(async () => undefined),
}));
vi.mock("../../features/source-control/hooks/useProjectDiffStats", () => ({
  useProjectDiffStats: () => null,
  useProjectsDiffStats: () => [],
}));
vi.mock("./SidebarUpdate", () => ({ SidebarUpdateFooter: () => null }));

it("places recovery beside Search and Working below Inbox, preserving navigation when collapsed", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onSelectProject = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(ProjectRail, {
          cwd: "/work/project",
          recents: [],
          onSelectProject,
          onOpenProject: vi.fn(),
          onSearch: vi.fn(),
          onOpenInbox: vi.fn(),
          recoveryControl: createElement(SessionRecoveryControl, { count: 28, onOpen: vi.fn() }),
          liveAgents: [
            {
              id: "background",
              cwd: "/work/project",
              title: "Review changes",
              harness: "codex",
              activity: "Working",
              needsApproval: false,
              done: false,
            },
          ],
        }),
      ),
    );
    const search = container.querySelector('button[aria-label="Search"]')!;
    const preview = container.querySelector('[data-live-agents-preview="full"]')!;
    const inbox = container.querySelector('button[aria-label="Inbox"]')!;
    const recovery = container.querySelector('button[aria-label="Recovered sessions (28)"]')!;
    expect(recovery.closest(".bycoda-rail-status")).not.toBeNull();
    expect(
      search.compareDocumentPosition(recovery) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(inbox.compareDocumentPosition(recovery) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(inbox.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(inbox.closest('[role="toolbar"]')?.hasAttribute("data-full-width")).toBe(true);
    expect(container.querySelectorAll('[data-live-agents-preview="full"]')).toHaveLength(1);
    const header = preview.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    act(() => header.click());
    expect(header.getAttribute("aria-expanded")).toBe("false");
    const project = container.querySelector<HTMLButtonElement>(
      '[data-project-path="/work/project"] > button',
    )!;
    expect(project.closest("[hidden]")).toBeNull();
    act(() => project.click());
    expect(onSelectProject).toHaveBeenCalledWith("/work/project");
  } finally {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
  }
});

it("shows project activity even without the Working preview and clears it on completion", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const agent = {
    id: "host-turn",
    cwd: "/work/arcade",
    title: "Improve game",
    harness: "codex" as const,
    activity: "Working on host",
    needsApproval: false,
    done: false,
  };
  const render = async (done: boolean) => {
    await act(async () =>
      root.render(
        createElement(ProjectRail, {
          cwd: "/work/bycoda",
          recents: [{ path: agent.cwd, openedAt: 1 }],
          busyPaths: workingProjectPaths([{ ...agent, done }]),
          liveAgents: [],
          onSelectProject: vi.fn(),
          onOpenProject: vi.fn(),
        }),
      ),
    );
  };
  try {
    await render(false);
    const project = container.querySelector('[data-project-path="/work/arcade"]')!;
    expect(project.getAttribute("data-project-working")).toBe("true");
    expect(
      project.querySelector("[data-project-working-indicator]")?.getAttribute("aria-label"),
    ).toBe("Working");
    expect(project.querySelector("button")?.getAttribute("aria-label")).toContain("working");
    expect(
      container
        .querySelector('[data-project-path="/work/bycoda"]')
        ?.hasAttribute("data-project-working"),
    ).toBe(false);
    await render(true);
    expect(project.hasAttribute("data-project-working")).toBe(false);
    expect(project.querySelector("[data-project-working-indicator]")).toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
  }
});
