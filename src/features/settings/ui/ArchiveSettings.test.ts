// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { archiveProject, rememberProject } from "../../projects/model/recents";
import { ArchivePage } from "./ArchiveSettings";

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
