// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InboxAvatar, InboxProjectPicker, type InboxProjectOption } from "./InboxPresentation";

vi.mock("../../group-lock/hooks/useGroupLock", () => ({
  useGroupLock: () => ({ groups: [{ id: "acme", name: "Acme", collapsed: true }] }),
}));
vi.mock("../../projects/model/projectGroups", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../projects/model/projectGroups")>()),
  useProjectGroupAssignments: () => ({
    "g:/acme/portal": "acme",
    "g:/acme/tests": "acme",
  }),
}));
vi.mock("../../projects/ui/ProjectMascot", () => ({
  ProjectMascot: ({ project }: { project: string }) =>
    createElement("svg", { "data-project": project }),
}));

const projects: InboxProjectOption[] = [
  { path: "G:/personal/app", name: "App", logoPath: null, mascotName: null, mascotColor: "" },
  { path: "G:/acme/portal", name: "Portal", logoPath: null, mascotName: null, mascotColor: "" },
  { path: "G:/acme/tests", name: "Tests", logoPath: null, mascotName: null, mascotColor: "" },
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
        value: "g:/ACME/portal",
        onChange: vi.fn(),
      }),
    ),
  );
  const trigger = container.querySelector("button")!;
  expect(trigger.querySelector('[data-project="Portal"]')).not.toBeNull();
  expect(container.querySelectorAll("[data-project]")).toHaveLength(1);
});
it.each(["👩🏽‍💻 Ada", "e\u0301mile", "🇹🇷 Ece"])(
  "keeps a complete first avatar grapheme: %s",
  async (name) => {
    await act(async () => root.render(createElement(InboxAvatar, { name })));
    expect(container.textContent).toBe(
      name.split(" ")[0] === "e\u0301mile" ? "E\u0301" : name.split(" ")[0],
    );
  },
);
it("shows the actual saved working folder when it is absent from recent projects", async () => {
  const value = "G:/saved/Backend 日本語 🚀";
  const onChange = vi.fn();
  await act(async () =>
    root.render(createElement(InboxProjectPicker, { projects, value, onChange })),
  );
  expect(container.querySelector("button")?.textContent).toContain("Backend 日本語 🚀");
  expect(container.querySelector("button")?.textContent).not.toContain("App");
  expect(onChange).not.toHaveBeenCalled();
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  const chosen = document.querySelector('[role="option"][aria-selected="true"]');
  expect(chosen?.textContent).toContain(value);
  expect(onChange).not.toHaveBeenCalled();
});

it("retains a long saved selection when the recent project list is empty", async () => {
  const value = `G:/saved/${"long-project-".repeat(12)}日本語`;
  const onChange = vi.fn();
  await act(async () =>
    root.render(createElement(InboxProjectPicker, { projects: [], value, onChange })),
  );
  expect(container.querySelector("button")?.textContent).toContain("日本語");
  expect(onChange).not.toHaveBeenCalled();
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
    "Acme",
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
  await search("acme/tests");
  expect(groups()).toHaveLength(1);
  expect(groups()[0]!.firstElementChild?.textContent).toBe("Acme");
  expect(document.body.querySelectorAll('[role="option"]')).toHaveLength(1);
  await search("Portal");
  await act(async () => document.body.querySelector<HTMLButtonElement>('[role="option"]')!.click());
  expect(onChange).toHaveBeenCalledExactlyOnceWith(projects[1]!.path);
});
