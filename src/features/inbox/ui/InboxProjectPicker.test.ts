// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InboxProjectPicker, type InboxProjectOption } from "./InboxPresentation";

vi.mock("../../group-lock/hooks/useGroupLock", () => ({
  useGroupLock: () => ({ groups: [{ id: "firisbe", name: "Firisbe", collapsed: true }] }),
}));
vi.mock("../../projects/model/projectGroups", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../projects/model/projectGroups")>()),
  useProjectGroupAssignments: () => ({
    "g:/firisbe/portal": "firisbe",
    "g:/firisbe/tests": "firisbe",
  }),
}));
vi.mock("../../projects/ui/ProjectMascot", () => ({
  ProjectMascot: ({ project }: { project: string }) =>
    createElement("svg", { "data-project": project }),
}));

const projects: InboxProjectOption[] = [
  { path: "G:/personal/app", name: "App", logoPath: null, mascotName: null, mascotColor: "" },
  { path: "G:/firisbe/portal", name: "Portal", logoPath: null, mascotName: null, mascotColor: "" },
  { path: "G:/firisbe/tests", name: "Tests", logoPath: null, mascotName: null, mascotColor: "" },
];
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("keeps the selected project mark inside the trigger", async () => {
  await act(async () =>
    root.render(
      createElement(InboxProjectPicker, {
        projects,
        value: "g:/FIRISBE/portal",
        onChange: vi.fn(),
      }),
    ),
  );
  const trigger = container.querySelector("button")!;
  expect(trigger.querySelector('[data-project="Portal"]')).not.toBeNull();
  expect(container.querySelectorAll("[data-project]")).toHaveLength(1);
});

it("groups sidebar projects, searches paths and names, and preserves selection callbacks", async () => {
  const onChange = vi.fn();
  await act(async () =>
    root.render(
      createElement(InboxProjectPicker, {
        projects,
        value: projects[1]!.path,
        onChange,
      }),
    ),
  );
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  const groups = () => Array.from(document.body.querySelectorAll('[role="group"]'));
  expect(groups().map((group) => group.firstElementChild?.textContent)).toEqual([
    "Firisbe",
    "Ungrouped",
  ]);
  expect(groups()[0]!.querySelectorAll('[role="option"]')).toHaveLength(2);
  const option = groups()[0]!.querySelector('[role="option"]')!;
  expect(option.querySelector('[data-project="Portal"]')).not.toBeNull();
  expect(option.querySelector(".bycoda-select-description")?.textContent).toBe(projects[1]!.path);

  const input = document.body.querySelector<HTMLInputElement>('[role="combobox"]')!;
  const search = async (value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await search("firisbe/tests");
  expect(groups()).toHaveLength(1);
  expect(groups()[0]!.firstElementChild?.textContent).toBe("Firisbe");
  expect(document.body.querySelectorAll('[role="option"]')).toHaveLength(1);
  await search("Portal");
  await act(async () => document.body.querySelector<HTMLButtonElement>('[role="option"]')!.click());
  expect(onChange).toHaveBeenCalledExactlyOnceWith(projects[1]!.path);
});
