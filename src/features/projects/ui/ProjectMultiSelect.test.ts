// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectMultiSelect, useProjectMultiSelect } from "./ProjectMultiSelect";
import {
  loadProjectGroupAssignments,
  loadProjectGroups,
  saveProjectGroups,
} from "../model/projectGroups";

vi.mock("./RemoveProjectDialog", () => ({
  RemoveProjectDialog: ({
    paths,
    onConfirm,
    onCancel,
    confirmDisabled,
  }: {
    paths: string[];
    onConfirm: () => void | Promise<void>;
    onCancel: () => void;
    confirmDisabled: boolean;
  }) =>
    createElement(
      "div",
      { role: "dialog" },
      paths.join(","),
      createElement(
        "button",
        {
          disabled: confirmDisabled,
          onClick: () => {
            void Promise.resolve(onConfirm()).catch(() => {});
          },
        },
        "Confirm deletion",
      ),
      createElement("button", { onClick: onCancel }, "Cancel deletion"),
    ),
}));
let root: Root;
let container: HTMLDivElement;
const remove = vi.fn();
const move = vi.fn();
function Rows() {
  const selection = useProjectMultiSelect()!;
  return createElement(
    "div",
    null,
    ["/a", "/b", "/c"].map((path) =>
      createElement(
        "button",
        {
          key: path,
          "aria-pressed": selection.selected.has(path),
          onClick: (event) => selection.toggle(path, event.shiftKey),
          onContextMenu: (event) => {
            event.preventDefault();
            selection.openActions(event.currentTarget);
          },
        },
        path,
      ),
    ),
  );
}
function render(paths = ["/a", "/b", "/c"], working = false) {
  act(() =>
    root.render(
      createElement(ProjectMultiSelect, {
        paths,
        groups: [],
        busy: () => working,
        canMove: () => true,
        onMove: move,
        onRemove: remove,
        children: createElement(Rows),
      }),
    ),
  );
}
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.textContent === label || element.getAttribute("aria-label") === label,
  )!;
const click = (label: string) => act(() => button(label).click());
const context = () =>
  act(() => button("/b").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })));
const action = (label: string) => {
  context();
  click(label);
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  remove.mockReset();
  move.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("selects a range, moves all selected projects and clears selection from its context menu", () => {
  render();
  click("/a");
  act(() => button("/c").dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })));
  expect(
    ["/a", "/b", "/c"].every((path) => button(path).getAttribute("aria-pressed") === "true"),
  ).toBe(true);
  action("Move down");
  expect([...move.mock.calls[0][0]]).toEqual(["/a", "/b", "/c"]);
  action("Clear selection");
  expect(
    ["/a", "/b", "/c"].every((path) => button(path).getAttribute("aria-pressed") === "false"),
  ).toBe(true);
});

it("requires deletion confirmation and invalidates it if a selected project becomes unavailable or busy", async () => {
  render();
  click("/a");
  click("/b");
  action("Delete selected");
  expect(remove).not.toHaveBeenCalled();
  render(["/b", "/c"]);
  expect(button("Confirm deletion").disabled).toBe(true);
  click("Cancel deletion");
  action("Delete selected");
  render(["/b", "/c"], true);
  expect(button("Confirm deletion").disabled).toBe(true);
  click("Cancel deletion");
  context();
  expect(button("Delete selected").disabled).toBe(true);
  act(() =>
    document
      .querySelector('[role="menu"]')!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  render(["/b", "/c"]);
  action("Delete selected");
  await act(async () => button("Confirm deletion").click());
  expect(remove).toHaveBeenCalledWith(["/b"]);
});

it("retains only failed or unprocessed projects after partial bulk deletion", async () => {
  let fail!: (reason: unknown) => void;
  remove.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, reject) => {
        fail = reject;
      }),
  );
  render();
  click("/a");
  click("/b");
  action("Delete selected");
  await act(async () => button("Confirm deletion").click());
  render(["/b", "/c"]);
  await act(async () => fail(new Error("Failed deleting /b")));
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("/b");
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("/a");
  expect(button("Confirm deletion").disabled).toBe(false);
  await act(async () => button("Confirm deletion").click());
  expect(remove).toHaveBeenLastCalledWith(["/b"]);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("creates one group for the selection and rejects a hidden destination with the same name", () => {
  render();
  click("/a");
  click("/b");
  context();
  click("Move to group");
  click("New group…");
  const setName = (value: string) =>
    act(() => {
      const input = document.querySelector<HTMLInputElement>("#project-selection-group-name")!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  setName("Team");
  act(() =>
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  const group = loadProjectGroups()[0];
  expect(group.name).toBe("Team");
  expect(loadProjectGroupAssignments()).toEqual({
    "/a": group.id,
    "/b": group.id,
  });
  saveProjectGroups([{ id: "secret", name: "Secret", collapsed: false }, group]);
  context();
  click("Move to group");
  click("New group…");
  setName("Secret");
  act(() =>
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(loadProjectGroupAssignments()["/a"]).toBe(group.id);
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
});

it("renders no toolbar or inline form before or during selection", () => {
  render();
  expect(container.querySelector('[role="toolbar"]')).toBeNull();
  expect(container.querySelector("form")).toBeNull();
  click("/a");
  expect(container.querySelector('[role="toolbar"]')).toBeNull();
  expect(container.querySelector("form")).toBeNull();
  expect(container.querySelector("select")).toBeNull();
});
