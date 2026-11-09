// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RemoteMachine } from "../../../connections/model/protocol";
import type { BrowserSettings as BrowserSettingsValue } from "../../model/socialActions";
import type { SocialClient } from "../../model/socialClient";
import { BrowserSettings } from "../accounts/BrowserSettings";

/**
 * Consent gates of browser-driven work, seen from the account's Browser card: a waiting screen
 * is shown as "Waiting for you", the live view never acts for the owner, and desktop control
 * stays off until the owner allows it and names the computer.
 */

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

const computers = [
  { id: "c1", name: "Studio Mac", endpoint: "", environmentId: "e1" },
  { id: "c2", name: "Office PC", endpoint: "", environmentId: "e2" },
] as unknown as RemoteMachine[];

let element: HTMLDivElement, root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.invoke.mockReset().mockImplementation(async () => computers);
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
  vi.unstubAllGlobals();
});

function settings(patch: Partial<BrowserSettingsValue> = {}): BrowserSettingsValue {
  return { accountId: "a1", visibility: "hidden", desktopControl: { allowed: false }, ...patch };
}

function clientWith(loaded: BrowserSettingsValue | Error = settings()) {
  const get = vi.fn(async (_accountId: string) => {
    if (loaded instanceof Error) throw loaded;
    return structuredClone(loaded);
  });
  const set = vi.fn(async (input: BrowserSettingsValue) => structuredClone(input));
  const resolve = vi.fn(async () => undefined);
  const browserViewFrame = vi.fn(async () => ({ jpegBase64: "QUFB", width: 10, height: 10 }));
  const browserViewInput = vi.fn(async () => undefined);
  const client = {
    browser: { settings: { get, set }, needsHuman: { resolve } },
    browserViewFrame,
    browserViewInput,
  } as unknown as SocialClient;
  return { client, get, set, resolve, browserViewFrame, browserViewInput };
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

async function mount(
  client: SocialClient,
  props: { needsHuman?: boolean; disabled?: boolean } = {},
) {
  await act(async () => {
    root.render(
      createElement(BrowserSettings, {
        client,
        accountId: "a1",
        accountName: "Studio",
        needsHuman: false,
        disabled: false,
        ...props,
      }),
    );
  });
  await settle();
}

function button(text: string): HTMLButtonElement {
  return [...element.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === text,
  )!;
}

function desktopSwitch(): HTMLButtonElement {
  return element.querySelector<HTMLButtonElement>('[role="switch"]')!;
}

async function chooseComputer(name: string) {
  const trigger = [
    ...element.querySelectorAll<HTMLButtonElement>('[aria-haspopup="listbox"]'),
  ].find((item) => item.getAttribute("aria-label")?.startsWith("Computer for desktop control"))!;
  await act(async () => trigger.click());
  const option = [...document.body.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
    (item) => item.textContent === name,
  )!;
  await act(async () => option.click());
}

it("shows a waiting-for-you state with guidance only when a recognised screen needs the owner", async () => {
  const { client } = clientWith();
  await mount(client, { needsHuman: true });
  expect(element.textContent).toContain("Waiting for you");
  expect(element.textContent).toContain("Open the live view to finish the step that needs you.");
  await mount(client, { needsHuman: false });
  expect(element.textContent).not.toContain(
    "Open the live view to finish the step that needs you.",
  );
});

it("opens the live view for the owner without resolving the wait, saving or sending input", async () => {
  const { client, set, resolve, browserViewFrame, browserViewInput } = clientWith();
  await mount(client, { needsHuman: true });
  await act(async () => button("Open live view").click());
  await settle();
  expect(element.querySelector('section[aria-label="Live browser view"]')).not.toBeNull();
  expect(browserViewFrame).toHaveBeenCalledWith("a1");
  expect(resolve).not.toHaveBeenCalled();
  expect(browserViewInput).not.toHaveBeenCalled();
  expect(set).not.toHaveBeenCalled();
  expect(element.textContent).toContain("Waiting for you");
  await act(async () => button("Close live view").click());
  expect(element.querySelector('section[aria-label="Live browser view"]')).toBeNull();
  expect(resolve).not.toHaveBeenCalled();
});

it("keeps desktop control off by default and offers no computer until it is allowed", async () => {
  const { client } = clientWith();
  await mount(client);
  expect(desktopSwitch().getAttribute("aria-checked")).toBe("false");
  expect(element.textContent).not.toContain("Choose a computer");
  expect(element.textContent).toContain(
    "Desktop control runs only when you're away and on another computer.",
  );
});

it("blocks saving allowed desktop control until the owner names the computer, then saves exactly that choice", async () => {
  const { client, set } = clientWith();
  await mount(client);
  await act(async () => desktopSwitch().click());
  expect(button("Save browser settings").disabled).toBe(true);
  expect(element.textContent).toContain("Choose the computer desktop control may use.");
  await act(async () => button("Save browser settings").click());
  expect(set).not.toHaveBeenCalled();
  await chooseComputer("Office PC");
  expect(button("Save browser settings").disabled).toBe(false);
  await act(async () => button("Save browser settings").click());
  await settle();
  expect(set).toHaveBeenCalledExactlyOnceWith({
    accountId: "a1",
    visibility: "hidden",
    desktopControl: { allowed: true, computerId: "c2" },
  });
  expect(element.textContent).toContain("No changes to save.");
});

it("blocks every change and explains why when this computer is not connected", async () => {
  const { client, set } = clientWith();
  await mount(client, { disabled: true });
  expect(desktopSwitch().disabled).toBe(true);
  expect(button("Open live view").disabled).toBe(true);
  expect(button("Save browser settings").disabled).toBe(true);
  expect(element.textContent).toContain("Connect to this computer to change this account.");
  expect(set).not.toHaveBeenCalled();
});

it("keeps the owner's edit and shows the Host's reason when saving fails", async () => {
  const { client, set } = clientWith();
  set.mockRejectedValueOnce(new Error("The Host refused the change."));
  await mount(client);
  await act(async () => desktopSwitch().click());
  await chooseComputer("Studio Mac");
  await act(async () => button("Save browser settings").click());
  await settle();
  expect(element.textContent).toContain("The Host refused the change.");
  expect(desktopSwitch().getAttribute("aria-checked")).toBe("true");
  expect(button("Save browser settings").disabled).toBe(false);
});

it("shows a read failure instead of editable settings", async () => {
  const { client } = clientWith(new Error("offline"));
  await mount(client);
  expect(element.textContent).toContain("The browser settings could not be read. Try again.");
  expect(element.querySelector('[role="switch"]')).toBeNull();
});
