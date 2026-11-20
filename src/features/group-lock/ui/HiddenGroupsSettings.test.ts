// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { pathKey } from "../../../shared/lib/paths";
import { saveProjectGroups, saveProjectGroupAssignments } from "../../projects/model/projectGroups";
import { getGroupLockView, hideGroup, isProjectLocked, setLockPassword } from "../model/groupLock";
import { GroupLockSettings, type GroupLockControls } from "./GroupLockSettings";

const writes = vi.hoisted(() => ({
  relock: vi.fn(),
  restore: null as null | ((id: string, temporary: boolean) => Promise<boolean>),
}));
vi.mock("../model/groupLock", async (original) => {
  const model = await original<typeof import("../model/groupLock")>();
  return {
    ...model,
    setRelockOnLaunch: writes.relock,
    restoreHiddenGroup: (id: string, temporary: boolean) =>
      writes.restore ? writes.restore(id, temporary) : model.restoreHiddenGroup(id, temporary),
  };
});

const controls: GroupLockControls = {
  Group: ({ id, title, description, children }) =>
    createElement("section", { id }, title, description, children),
  Row: ({ label, description, children, feedback }) =>
    createElement("div", null, label, description, children, feedback),
  Toggle: ({ label, on, onChange, disabled }) =>
    createElement("button", {
      disabled,
      onClick: () => onChange(!on),
      "aria-label": label,
    }),
  Select: ({ label, disabled }) => createElement("select", { "aria-label": label, disabled }),
};
let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("crypto", webcrypto);
  writes.relock.mockReset().mockResolvedValue(true);
  writes.restore = null;
  localStorage.clear();
  window.dispatchEvent(new StorageEvent("storage", { key: null }));
  saveProjectGroups([{ id: "secret", name: "My secret project group", collapsed: false }]);
  saveProjectGroupAssignments({ [pathKey("/private")]: "secret" });
  await hideGroup("secret");
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
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) =>
    item.querySelector('[aria-hidden="true"]')
      ? [...item.querySelectorAll("span")].some(
          (span) => !span.closest('[aria-hidden="true"]') && span.textContent === label,
        )
      : item.textContent === label,
  )!;

it("restores temporarily and permanently through Settings without the rail icon", async () => {
  await act(async () => root.render(createElement(GroupLockSettings, { controls })));
  expect(container.querySelector("#hidden-project-groups")?.textContent).toContain(
    "My secret project group",
  );
  expect(container.querySelector("#group-lock-groups")?.textContent).not.toContain(
    "My secret project group",
  );
  await act(async () => {
    button("Show temporarily").click();
    await Promise.resolve();
  });
  expect(isProjectLocked("/private")).toBe(false);
  expect(button("Hide again")).toBeDefined();
  await act(async () => {
    button("Hide again").click();
    await Promise.resolve();
  });
  expect(isProjectLocked("/private")).toBe(true);
  await act(async () => {
    button("Make visible").click();
    await Promise.resolve();
  });
  expect(isProjectLocked("/private")).toBe(false);
  expect(container.querySelector("#hidden-project-groups")?.textContent).toContain(
    "No hidden groups",
  );
});

it("names every row action by its group and explains why other rows are disabled during a write", async () => {
  saveProjectGroups([
    { id: "secret", name: "My secret project group", collapsed: false },
    { id: "other", name: "Other private group", collapsed: false },
  ]);
  saveProjectGroupAssignments({ [pathKey("/private")]: "secret", [pathKey("/other")]: "other" });
  await hideGroup("other");
  await act(async () => root.render(createElement(GroupLockSettings, { controls })));
  const named = (label: string) =>
    container.querySelector<HTMLButtonElement>(`#hidden-project-groups [aria-label="${label}"]`)!;
  for (const name of ["My secret project group", "Other private group"]) {
    expect(named(`Show temporarily: ${name}`)).not.toBeNull();
    expect(named(`Make visible: ${name}`)).not.toBeNull();
  }
  let finish!: (saved: boolean) => void;
  writes.restore = () =>
    new Promise<boolean>((resolve) => {
      finish = resolve;
    });
  await act(async () => named("Show temporarily: My secret project group").click());
  for (const label of [
    "Show temporarily: Other private group",
    "Make visible: Other private group",
    "Make visible: My secret project group",
  ]) {
    const action = named(label);
    expect(action.getAttribute("aria-disabled")).toBe("true");
    expect(action.getAttribute("aria-description")).toBe(
      "Wait for the current visibility change to finish.",
    );
  }
  await act(async () => finish(true));
  expect(named("Make visible: Other private group").hasAttribute("aria-disabled")).toBe(false);
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

it("shows complete long management identity only after hidden-group authorization", async () => {
  const name = `Araştırma ekibi مرحبا 📁 ${"unbroken-group-identity-".repeat(18)}`;
  saveProjectGroups([{ id: "secret", name, collapsed: false }]);
  await setLockPassword("correct-password");
  await act(async () => root.render(createElement(GroupLockSettings, { controls })));
  expect(container.textContent).not.toContain(name);
  await act(async () => button("Manage hidden groups…").click());
  const field = document.querySelector<HTMLInputElement>('input[type="password"]')!;
  field.value = "correct-password";
  await act(async () => {
    field.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(getGroupLockView().hiddenGroupsAuthorized).toBe(true));
  });
  const identity = [...container.querySelectorAll("#hidden-project-groups p")].find(
    (text) => text.textContent === name,
  )!;
  expect(identity.getAttribute("data-wrap")).toBe("anywhere");
  expect(identity.hasAttribute("data-truncate")).toBe(false);
  await act(async () => button("Conceal group names").click());
  expect(container.textContent).not.toContain(name);
});

it("disables only the preference with a pending write and retains local retry feedback", async () => {
  let finish!: (saved: boolean) => void;
  writes.relock.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => root.render(createElement(GroupLockSettings, { controls })));
  const relock = container.querySelector<HTMLButtonElement>('[aria-label="Lock on startup"]')!;
  const together = container.querySelector<HTMLButtonElement>(
    '[aria-label="Unlock groups together"]',
  )!;
  const idle = container.querySelector<HTMLSelectElement>(
    '[aria-label="Auto-lock after inactivity"]',
  )!;
  await act(async () => relock.click());
  expect(relock.disabled).toBe(true);
  expect(together.disabled).toBe(false);
  expect(idle.disabled).toBe(false);
  await act(async () => relock.click());
  expect(writes.relock).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(container.textContent).toContain("Saving…"));
  await act(async () => finish(false));
  expect(relock.disabled).toBe(false);
  expect(container.textContent).toContain("Applied in this window, but not saved.");
  expect(button("Retry")).toBeDefined();
});
