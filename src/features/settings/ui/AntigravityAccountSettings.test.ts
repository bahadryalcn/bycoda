// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  available: false,
  version: 0,
  listeners: new Set<() => void>(),
  probe: vi.fn(),
  discover: vi.fn(),
  setModels: vi.fn(),
}));
vi.mock("../../../integrations/harness/core/availability", () => ({
  getHarnessAvailabilitySnapshot: () => mock.version,
  isHarnessAvailable: (id: string) => id === "antigravity" && mock.available,
  probeHarnessAvailability: mock.probe,
  subscribeHarnessAvailability: (fn: () => void) => {
    mock.listeners.add(fn);
    return () => mock.listeners.delete(fn);
  },
}));
vi.mock("../../../integrations/harness/providers/antigravity/antigravityCatalog", () => ({
  discoverAntigravityModels: mock.discover,
}));
vi.mock("../../sessions/model/models", () => ({
  setHarnessModels: mock.setModels,
}));
import { AntigravityAccountSettings } from "./AntigravityAccountSettings";
import { RevealedSetting } from "../../../shared/ui/settings";

/** Opens the info popover and returns the page text, popover content included. */
function helpText() {
  act(() => [...container.querySelectorAll<HTMLButtonElement>('button[aria-label="Help"]')].at(-1)!.click());
  return document.body.textContent ?? "";
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mock.available = false;
  mock.version = 0;
  vi.clearAllMocks();
  mock.probe.mockResolvedValue(undefined);
  mock.discover.mockResolvedValue([]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
function render() {
  act(() => root.render(createElement(AntigravityAccountSettings)));
}
function button() {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (node) =>
      node.textContent?.includes("Check installation and models") ||
      node.textContent?.includes("Checking"),
  )!;
}

it("opens shared-account setup from Accounts without offering unsupported named profiles", () => {
  act(() => root.render(createElement(AntigravityAccountSettings, { embedded: true })));
  const details = container.querySelector<HTMLDetailsElement>("#setting-antigravity-account")!;
  const setup = details.querySelector<HTMLElement>("summary")!;
  expect(setup.textContent).toContain("Setup");
  expect(details.open).toBe(false);
  act(() => {
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
  expect(details.open).toBe(true);
  const popoverText = helpText();
  expect(popoverText).toContain(
    "bycoda uses the shared Antigravity CLI account on this computer",
  );
  expect(popoverText).toContain("/logout");
  expect(container.textContent).not.toContain("Add account");
  act(() => {
    details.open = false;
    details.dispatchEvent(new Event("toggle"));
  });
  expect(details.open).toBe(false);
});

it("shows both native installers and the real agy authentication instructions", () => {
  render();
  expect(container.textContent).toContain("Antigravity CLI account");
  expect(container.textContent).toContain("irm https://antigravity.google/cli/install.ps1 | iex");
  expect(container.textContent).toContain(
    "curl -fsSL https://antigravity.google/cli/install.sh | bash",
  );
  const popoverText = helpText();
  expect(popoverText).toContain("GEMINI_API_KEY");
  expect(popoverText).toContain("enterprise Gemini Code Assist");
  expect(container.textContent).not.toContain("npm install");
});

it("expands shared-account instructions when Settings search reveals them", () => {
  act(() =>
    root.render(
      createElement(
        RevealedSetting.Provider,
        { value: "antigravity-account" },
        createElement(AntigravityAccountSettings, { embedded: true }),
      ),
    ),
  );
  expect(container.querySelector<HTMLDetailsElement>("details")?.open).toBe(true);
});
it("does not discover models or claim sign-in when the CLI is missing", async () => {
  render();
  await act(async () => button().click());
  expect(mock.probe).toHaveBeenCalledWith({ force: true });
  expect(mock.discover).not.toHaveBeenCalled();
  expect(container.textContent).toContain("CLI was not found");
});
it("rechecks Antigravity and refreshes its model picker without claiming account authentication", async () => {
  const models = [
    {
      id: "antigravity:flash",
      harness: "antigravity",
      name: "Flash",
      nativeId: "flash",
    },
  ];
  mock.probe.mockImplementation(async () => {
    mock.available = true;
    mock.version++;
    mock.listeners.forEach((fn) => fn());
  });
  mock.discover.mockResolvedValue(models);
  render();
  await act(async () => button().click());
  expect(mock.setModels).toHaveBeenCalledWith("antigravity", models);
  expect(container.textContent).toContain("Antigravity models refreshed");
  expect(container.textContent).not.toContain("Signed in");
  expect(container.textContent).not.toContain("install.ps1");
});
it("shows discovery errors and allows retry", async () => {
  mock.available = true;
  mock.discover.mockRejectedValueOnce(new Error("Authentication required"));
  render();
  await act(async () => button().click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Authentication required",
  );
  expect(button().disabled).toBe(false);
  await act(async () => button().click());
  expect(container.textContent).toContain("No Antigravity models");
  expect(mock.setModels).not.toHaveBeenCalled();
});
