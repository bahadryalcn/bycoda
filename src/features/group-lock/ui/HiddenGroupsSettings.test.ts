// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { pathKey } from "../../../shared/lib/paths";
import { saveProjectGroups, saveProjectGroupAssignments } from "../../projects/model/projectGroups";
import { getGroupLockView, hideGroup, isProjectLocked, setLockPassword } from "../model/groupLock";
import { GroupLockSettings, type GroupLockControls } from "./GroupLockSettings";

const controls: GroupLockControls = {
  Group: ({ id, title, description, children }) =>
    createElement("section", { id }, title, description, children),
  Row: ({ label, description, children }) =>
    createElement("div", null, label, description, children),
  Toggle: ({ label, on, onChange }) =>
    createElement("button", {
      onClick: () => onChange(!on),
      "aria-label": label,
    }),
  Select: ({ label }) => createElement("select", { "aria-label": label }),
};
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("crypto", webcrypto);
  localStorage.clear();
  window.dispatchEvent(new StorageEvent("storage", { key: null }));
  saveProjectGroups([{ id: "secret", name: "My secret project group", collapsed: false }]);
  saveProjectGroupAssignments({ [pathKey("/private")]: "secret" });
  hideGroup("secret");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => (item.querySelector('[aria-hidden="true"]')
      ? [...item.querySelectorAll("span")].some((span) => !span.closest('[aria-hidden="true"]') && span.textContent === label)
      : item.textContent === label),
  )!;

it("restores temporarily and permanently through Settings without the rail icon", async () => {
  await act(async () => root.render(createElement(GroupLockSettings, { controls })));
  expect(container.querySelector("#hidden-project-groups")?.textContent).toContain(
    "My secret project group",
  );
  expect(container.querySelector("#group-lock-groups")?.textContent).not.toContain(
    "My secret project group",
  );
  act(() => button("Show temporarily").click());
  expect(isProjectLocked("/private")).toBe(false);
  expect(button("Hide again")).toBeDefined();
  act(() => button("Hide again").click());
  expect(isProjectLocked("/private")).toBe(true);
  act(() => button("Make visible").click());
  expect(isProjectLocked("/private")).toBe(false);
  expect(container.querySelector("#hidden-project-groups")?.textContent).toContain(
    "No hidden groups",
  );
});

it("conceals hidden names everywhere in Settings until the password dialog succeeds", async () => {
  await setLockPassword("correct-password");
  await act(async () => root.render(createElement(GroupLockSettings, { controls })));
  expect(container.textContent).not.toContain("My secret project group");
  act(() => button("Manage hidden groups…").click());
  const field = document.querySelector<HTMLInputElement>('input[type="password"]')!;
  field.value = "correct-password";
  await act(async () => {
    field.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(getGroupLockView().hiddenGroupsAuthorized).toBe(true));
  });
  expect(container.textContent).toContain("My secret project group");
  expect(isProjectLocked("/private")).toBe(true);
  act(() => button("Conceal group names").click());
  expect(container.textContent).not.toContain("My secret project group");
});
