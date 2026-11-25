// @vitest-environment happy-dom
import { LOADING_DELAY_MS } from "../../../shared/hooks/useDelayedVisible";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { archiveProject, rememberProject } from "../../projects/model/recents";
import { ArchivePage } from "./ArchiveSettings";
import { formatArchiveDate } from "../../../shared/i18n/format";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";
import * as lockState from "../../group-lock/model/lockState";
import * as projectData from "../../projects/model/projectData";
import { saveTabGroupLabel } from "../../workspace/model/tabGroups";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const baseProps = {
  cwd: "/work/app",
  sessions: [],
  onOpenSession: vi.fn(),
  onArchiveSession: vi.fn(),
  onDeleteSession: vi.fn(),
};
const button = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent === label,
  );

it.each(["relocked", "removed", "unavailable"])(
  "refuses a stale Restore after its project is %s before the next render",
  async (change) => {
    rememberProject("/work/stale");
    archiveProject("/work/stale");
    const restore = vi.fn();
    await act(async () =>
      root.render(
        createElement(ArchivePage, {
          ...baseProps,
          onRestoreProject: restore,
          onDeleteProject: vi.fn(),
        }),
      ),
    );
    const restoreButton = button("Restore")!;
    if (change === "relocked") vi.spyOn(lockState, "isProjectLockedIn").mockReturnValue(true);
    else localStorage.setItem("bycoda.archivedProjects", change === "removed" ? "[]" : "{broken");
    await act(async () => restoreButton.click());
    expect(restore).not.toHaveBeenCalled();
    expect(container.textContent).toContain("The project could not be restored.");
  },
);

it.each(["removed", "unavailable"])(
  "refuses a stale Delete confirmation after the archive becomes %s",
  async (change) => {
    vi.spyOn(projectData, "projectSessionCount").mockResolvedValue(0);
    rememberProject("/work/stale");
    archiveProject("/work/stale");
    const remove = vi.fn();
    await act(async () =>
      root.render(
        createElement(ArchivePage, {
          ...baseProps,
          onRestoreProject: vi.fn(),
          onDeleteProject: remove,
        }),
      ),
    );
    await act(async () => button("Delete")!.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    const confirm = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent === "Delete",
    )!;
    expect(confirm).toBeDefined();
    localStorage.setItem("bycoda.archivedProjects", change === "removed" ? "[]" : "{broken");
    await act(async () => confirm.click());
    expect(remove).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("The operation did not complete");
  },
);

it("renders missing or invalid Archive dates as blank", () => {
  expect(formatArchiveDate(0)).toBe("");
  expect(formatArchiveDate(Number.NaN)).toBe("");
});

it("does not read a failed or pending history load as an empty archive", async () => {
  const onRetry = vi.fn();
  await act(async () =>
    root.render(
      createElement(ArchivePage, {
        ...baseProps,
        sessionsStatus: { state: "unavailable", onRetry },
      }),
    ),
  );
  expect(container.textContent).not.toContain("No archived conversations in this project.");
  expect(container.textContent).toContain("Archived conversations could not be loaded.");
  act(() => button("Retry")!.click());
  expect(onRetry).toHaveBeenCalledTimes(1);

  await act(async () =>
    root.render(createElement(ArchivePage, { ...baseProps, sessionsStatus: { state: "loading" } })),
  );
  expect(container.textContent).not.toContain("No archived conversations in this project.");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, LOADING_DELAY_MS + 50));
  });
  expect(container.textContent).toContain("Loading…");

  await act(async () =>
    root.render(createElement(ArchivePage, { ...baseProps, sessionsStatus: { state: "ready" } })),
  );
  expect(container.textContent).toContain("No archived conversations in this project.");
});

it("reports unreadable archived-project storage instead of an empty list, then recovers", async () => {
  localStorage.setItem("bycoda.archivedProjects", "{broken");
  await act(async () => root.render(createElement(ArchivePage, baseProps)));
  expect(container.textContent).toContain("Archived projects could not be read");
  expect(container.textContent).not.toContain("No archived projects.");

  localStorage.setItem("bycoda.archivedProjects", "[]");
  await act(async () => button("Retry")!.click());
  expect(container.textContent).toContain("No archived projects.");
});

it("refreshes the project archive for its own local storage changes, clear and window focus", async () => {
  const key = "bycoda.archivedProjects";
  await act(async () => root.render(createElement(ArchivePage, baseProps)));
  const change = (key: string | null, storageArea = localStorage) =>
    act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key, storageArea }));
    });
  localStorage.setItem(key, JSON.stringify([{ path: "/work/sibling", archivedAt: 1 }]));
  await change("bycoda.unrelated");
  await change(key, sessionStorage);
  expect(container.textContent).toContain("No archived projects.");
  await change(key);
  expect(container.textContent).toContain("/work/sibling");
  localStorage.clear();
  await change(null);
  expect(container.textContent).toContain("No archived projects.");
  localStorage.setItem(key, "{broken");
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(container.textContent).toContain("Archived projects could not be read");
});

it("confirms a project restore from storage rather than from the callback returning", async () => {
  rememberProject("/work/restored");
  archiveProject("/work/restored");
  const doNothing = vi.fn();
  await act(async () =>
    root.render(
      createElement(ArchivePage, {
        ...baseProps,
        onRestoreProject: doNothing,
        onDeleteProject: vi.fn(),
      }),
    ),
  );
  await act(async () => button("Restore")!.click());
  expect(doNothing).toHaveBeenCalledWith("/work/restored");
  expect(container.textContent).toContain("could not be restored");

  const restore = vi.fn((path: string) => {
    rememberProject(path);
  });
  await act(async () =>
    root.render(
      createElement(ArchivePage, {
        ...baseProps,
        onRestoreProject: restore,
        onDeleteProject: vi.fn(),
      }),
    ),
  );
  await act(async () => button("Restore")!.click());
  expect(container.textContent).not.toContain("could not be restored");
  expect(container.textContent).toContain("No archived projects.");
});

it("windows a large archive and filters it in place on the same list", async () => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute("data-index") ? 44 : 480;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(480);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(640);
  resetRetainedState();
  rememberProject("/work/archived");
  archiveProject("/work/archived");
  const sessions = Array.from({ length: 400 }, (_, index) => ({
    id: `s${index}`,
    cwd: "/work/app",
    title: `${index < 64 ? "Batch " : ""}${index % 100 === 7 ? "Needle" : "Chat"} ${index}`,
    harness: "codex" as const,
    model: "m",
    runtimeMode: "supervised" as const,
    createdAt: 1,
    updatedAt: 1_000 + index,
    archived: true,
  }));
  await act(async () =>
    root.render(createElement(ArchivePage, { ...baseProps, sessions, sessionsStatus: undefined })),
  );
  const conversations = container.querySelector('[data-setting-id="archived-conversations"]')!;
  const mounted = () => conversations.querySelectorAll("[data-collection-key]").length;
  expect(mounted()).toBeGreaterThan(0);
  expect(mounted()).toBeLessThan(60);
  expect(container.textContent).toContain("Showing 400 of 400 archived conversations");

  const search = container.querySelector<HTMLInputElement>(
    'input[aria-label="Search archived conversations"]',
  )!;
  const reads = vi.spyOn(Storage.prototype, "getItem");
  const filter = (query: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        search,
        query,
      );
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await filter("batch");
  expect(container.textContent).toContain("Showing 64 of 400 archived conversations");
  expect(mounted()).toBeGreaterThan(0);
  expect(mounted()).toBeLessThan(32);
  await filter(" NEEDLE ");
  expect(container.textContent).toContain("Showing 4 of 400 archived conversations");
  expect(mounted()).toBe(4);
  expect(container.querySelector('[data-collection-key="s7"]')).not.toBeNull();
  expect(conversations.querySelectorAll("[data-continuous-list]")).toHaveLength(1);
  expect(reads.mock.calls.map(([key]) => key)).not.toContain("bycoda:tab-group:labels");
});

it("windows archived projects and filters by an updated project label", async () => {
  const projects = Array.from({ length: 200 }, (_, index) => ({
    path: `/work/project-${index}`,
    archivedAt: index + 1,
  }));
  localStorage.setItem("bycoda.archivedProjects", JSON.stringify(projects));
  await act(async () => root.render(createElement(ArchivePage, baseProps)));
  const group = container.querySelector('[data-setting-id="archived-projects"]')!;
  expect(group.querySelectorAll(".settings-collection-row").length).toBeLessThan(60);
  await act(async () => saveTabGroupLabel("/work/project-188", "Renamed archive"));
  const search = group.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      search,
      "RENAMED",
    );
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(group.querySelectorAll(".settings-collection-row")).toHaveLength(1);
  expect(group.textContent).toContain("Renamed archive");
  expect(group.textContent).toContain("project-188");
});
