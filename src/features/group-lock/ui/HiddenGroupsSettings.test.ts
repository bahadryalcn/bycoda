// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { pathKey } from "../../../shared/lib/paths";
import { saveProjectGroups, saveProjectGroupAssignments } from "../../projects/model/projectGroups";
import { getGroupLockView, hideGroup, isProjectLocked, setLockPassword } from "../model/groupLock";
import { GroupLockSettings, type GroupLockControls } from "./GroupLockSettings";

const writes = vi.hoisted(() => ({ relock: vi.fn() }));
vi.mock("../model/groupLock", async (original) => ({
  ...(await original<typeof import("../model/groupLock")>()),
  setRelockOnLaunch: writes.relock,
}));

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
  const relock = container.querySelector<HTMLButtonElement>(
    '[aria-label^="Lock groups again when"]',
  )!;
  const together = container.querySelector<HTMLButtonElement>(
    '[aria-label="Unlocking one group unlocks all"]',
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
