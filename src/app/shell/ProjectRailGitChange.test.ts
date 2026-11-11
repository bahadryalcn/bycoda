// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectRail } from "./ProjectRail";
import { savePinnedProjects } from "../../features/projects/model/recents";
import { loadRailSectionCollapse } from "../../features/projects/model/railSections";

type Stats = { files: number; additions: number; deletions: number } | null;
const stats = new Map<string, Stats>();

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(async () => undefined),
}));
vi.mock("../../features/source-control/hooks/useProjectDiffStats", () => ({
  useProjectDiffStats: (cwd: string) => stats.get(cwd) ?? null,
  useProjectsDiffStats: (cwds: string[]) => cwds.map((cwd) => stats.get(cwd) ?? null),
}));
vi.mock("./SidebarUpdate", () => ({ SidebarUpdateFooter: () => null }));

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  stats.clear();
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function renderRail(paths: string[], pinnedPaths: string[] = []) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  localStorage.setItem("bycoda.language", "en");
  savePinnedProjects(pinnedPaths);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(ProjectRail, {
        cwd: paths[0],
        recents: paths.map((path, index) => ({ path, openedAt: 100 - index })),
        onSelectProject: vi.fn(),
        onOpenProject: vi.fn(),
      }),
    ),
  );
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return container;
}

const rowButton = (container: HTMLElement, path: string) =>
  container.querySelector<HTMLButtonElement>(`[data-project-path="${path}"] > button`)!;

/** Hovers a control until the shared tooltip opens and returns its text. */
async function tooltipText(element: HTMLElement): Promise<string> {
  await act(async () => {
    element.dispatchEvent(new Event("pointerover", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 520));
  });
  const text = document.querySelector('[role="tooltip"]')?.textContent ?? "";
  await act(async () => {
    element.dispatchEvent(new Event("pointerout", { bubbles: true }));
  });
  return text;
}

it("keeps wide detail and compact mark in one decorative slot, with the full change in the name and tooltip", async () => {
  stats.set("/work/both", { files: 3, additions: 120149, deletions: 1344 });
  const container = await renderRail(["/work/both"]);
  const button = rowButton(container, "/work/both");
  const mark = button.querySelector<HTMLElement>("[data-project-git]")!;
  expect(mark.querySelector("[data-git-detail]")?.textContent).toBe("+120,149-1,344");
  expect(mark.querySelector("[data-git-compact] [data-git-count]")?.textContent).toBe("3");
  expect(mark.hasAttribute("data-git-bucket")).toBe(true);
  // Decorative: the button's accessible name and tooltip carry files and lines separately.
  expect(mark.querySelector("[data-git-detail]")?.getAttribute("aria-hidden")).toBe("true");
  expect(button.getAttribute("aria-label")).toBe(
    "both, 3 changed files, 120,149 lines added, 1,344 lines removed",
  );
  expect(button.title).toBe("");
  expect(await tooltipText(button)).toContain("3 files · +120,149 -1,344 uncommitted");
  expect(button.querySelectorAll("button")).toHaveLength(0);
});

it("shows file-only changes (binary or untracked) in the compact form without invented lines", async () => {
  stats.set("/work/binary", { files: 4, additions: 0, deletions: 0 });
  const container = await renderRail(["/work/binary"]);
  const button = rowButton(container, "/work/binary");
  const mark = button.querySelector<HTMLElement>("[data-project-git]")!;
  expect(mark.querySelector("[data-git-detail]")).toBeNull();
  expect(mark.hasAttribute("data-git-bucket")).toBe(false);
  expect(mark.querySelector("[data-git-count]")?.textContent).toBe("4");
  expect(button.getAttribute("aria-label")).toBe("binary, 4 changed files");
});

it("shows no Git mark and no clean claim without data, a failed read or a clean tree", async () => {
  stats.set("/work/tidy", { files: 0, additions: 0, deletions: 0 });
  // "/work/unknown" has no stats entry: not loaded or unreachable.
  const container = await renderRail(["/work/tidy", "/work/unknown"]);
  for (const name of ["tidy", "unknown"]) {
    const button = rowButton(container, `/work/${name}`);
    expect(button.querySelector("[data-project-git]")).toBeNull();
    expect(button.getAttribute("aria-label")).toBe(name);
    expect(await tooltipText(button)).not.toMatch(/uncommitted|clean/i);
  }
});

it("adds the parent folder to same-named local projects only", async () => {
  const container = await renderRail(["/work/app", "/clients/acme/app", "/work/site"]);
  expect(rowButton(container, "/work/app").getAttribute("aria-label")).toBe("app (work)");
  expect(rowButton(container, "/clients/acme/app").getAttribute("aria-label")).toBe("app (acme)");
  expect(rowButton(container, "/work/site").getAttribute("aria-label")).toBe("site");
  // The stored name is untouched: the visible name is still just "app".
  expect(rowButton(container, "/work/app").textContent).toContain("app");
  const tip = await tooltipText(rowButton(container, "/work/app"));
  expect(tip).toContain("app");
  expect(tip).toContain("/work/app");
});

it("keeps project identity and hover actions in aligned slots without reserving an empty tail", async () => {
  stats.set("/work/changed", { files: 2, additions: 9, deletions: 1 });
  const container = await renderRail(["/work/changed"]);
  const row = container.querySelector<HTMLElement>('[data-project-path="/work/changed"]')!;
  expect(row.hasAttribute("data-hover-reveal")).toBe(true);
  expect(row.querySelector("[data-project-pin]")).not.toBeNull();
  expect(row.querySelector("[data-project-options]")).not.toBeNull();
  expect(row.querySelector("[data-project-primary]")?.classList.contains("pe-6")).toBe(false);
});

it("collapses pinned projects through their icon header and saves the state", async () => {
  const container = await renderRail(["/work/pinned"], ["/work/pinned"]);
  const heading = [...container.querySelectorAll<HTMLElement>("[data-rail-section-header]")].find(
    (header) => header.textContent?.includes("Pinned"),
  )!;
  const toggle = heading.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
  expect(toggle).not.toBeNull();
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  await act(async () => toggle.click());
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(loadRailSectionCollapse()).toMatchObject({ pinned: true });
  expect(
    container.querySelector('[data-project-path="/work/pinned"]')?.closest("[hidden]"),
  ).not.toBeNull();
  await act(async () => toggle.click());
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(
    container.querySelector('[data-project-path="/work/pinned"]')?.closest("[hidden]"),
  ).toBeNull();
});
