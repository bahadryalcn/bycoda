// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ProjectRail } from "./ProjectRail";
import { saveProjectGroups } from "../../features/projects/model/projectGroups";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(async () => undefined),
}));
vi.mock("../../features/source-control/hooks/useProjectDiffStats", () => ({
  useProjectDiffStats: () => null,
  useProjectsDiffStats: () => [],
}));
vi.mock("./SidebarUpdate", () => ({ SidebarUpdateFooter: () => null }));
vi.mock("../../features/projects/model/projectData", () => ({
  projectSessionCount: vi.fn(async () => 0),
}));

it("surfaces a rejected add-to-group picker as a retryable, dismissible rail error", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  saveProjectGroups([{ id: "team", name: "Team", collapsed: false }]);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onOpenProject = vi.fn().mockRejectedValueOnce(new Error("picker exploded"));
  const errorText = "Could not add projects to the group. Please try again.";
  const button = (label: string) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (element) => element.textContent === label || element.getAttribute("aria-label") === label,
    );
  try {
    await act(async () =>
      root.render(
        createElement(ProjectRail, {
          cwd: "/a",
          recents: [{ path: "/a", openedAt: 1 }],
          onSelectProject: vi.fn(),
          onOpenProject,
        }),
      ),
    );
    expect(container.textContent).not.toContain(errorText);
    const openPicker = async () => {
      act(() =>
        container
          .querySelector<HTMLElement>("[data-group-row]")!
          .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
      );
      const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (element) => element.textContent?.startsWith("Add project to group"),
      )!;
      await act(async () => item.click());
    };
    await openPicker();
    expect(onOpenProject).toHaveBeenCalledTimes(1);
    // A failed picker is not swallowed as a cancel.
    expect(container.textContent).toContain(errorText);
    // Retry re-runs the picker (which now resolves as a cancel) and clears the error.
    await act(async () => button("Try again")!.click());
    expect(onOpenProject).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain(errorText);
    // Fail again, then Dismiss clears the error without another picker call.
    onOpenProject.mockRejectedValueOnce(new Error("picker exploded again"));
    await openPicker();
    expect(container.textContent).toContain(errorText);
    act(() => button("Dismiss")!.click());
    expect(container.textContent).not.toContain(errorText);
    expect(onOpenProject).toHaveBeenCalledTimes(3);
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
