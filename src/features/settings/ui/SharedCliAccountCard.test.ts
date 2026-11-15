// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ probed: true, available: true }));
vi.mock("../../../integrations/harness/core/availability", () => ({
  getHarnessAvailabilitySnapshot: () => 0,
  hasProbedHarnessAvailability: () => mock.probed,
  isHarnessAvailable: () => mock.available,
  subscribeHarnessAvailability: () => () => {},
}));
import { SharedCliAccountCard } from "./SharedCliAccountCard";
import { sharedCliAccount } from "../../providers/model/providerAccounts";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  mock.probed = true;
  mock.available = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

const button = (label: string) =>
  [...document.querySelectorAll<HTMLElement>("button, [role='menuitem']")].find(
    (node) => node.textContent?.trim() === label || node.getAttribute("aria-label") === label,
  )!;

it("shows the shared sign-in as a named account row without profile actions", () => {
  act(() => root.render(createElement(SharedCliAccountCard, { provider: "opencode" })));
  const row = container.querySelector("[data-settings-part='account']")!;
  expect(row.textContent).toContain("OpenCode");
  expect(row.textContent).toContain("Shared CLI profile");
  expect(container.textContent).not.toContain("Add account");
  expect(container.textContent).not.toContain("Not installed");
});

it("renames the shared sign-in from the account menu", () => {
  act(() => root.render(createElement(SharedCliAccountCard, { provider: "antigravity" })));
  act(() => button("Actions for Antigravity").click());
  act(() => button("Edit account").click());
  const input = document.querySelector<HTMLInputElement>("dialog input, [role='dialog'] input")!;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, "Google work");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => input.form!.requestSubmit());
  expect(sharedCliAccount("antigravity").label).toBe("Google work");
  expect(container.querySelector("[data-settings-part='account']")!.textContent).toContain(
    "Google work",
  );
});

it("flags a missing CLI", () => {
  mock.available = false;
  act(() => root.render(createElement(SharedCliAccountCard, { provider: "opencode" })));
  expect(container.textContent).toContain("Not installed");
});
