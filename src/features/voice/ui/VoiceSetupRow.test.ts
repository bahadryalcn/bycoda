// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("../../../platform/tauri/openExternal", () => ({ openExternal: vi.fn(async () => {}) }));
import { VoiceSetupRow } from "./VoiceSetupRow";
import type { VoiceSetup } from "./useVoiceSetup";
import { loadVoiceSettings } from "../model/voiceSettings";

let root: Root | undefined, container: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
});

async function render(overrides: Partial<VoiceSetup>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const setup = {
    installing: false,
    busy: false,
    ready: false,
    visibleError: undefined,
    pythonMissing: false,
    message: "Voice setup is needed",
    detail: undefined,
    setupError: false,
    working: false,
    setupHint: undefined,
    gpuUnavailable: false,
    gpuUpgrade: undefined,
    locating: false,
    install: vi.fn(),
    ...overrides,
  } as unknown as VoiceSetup;
  await act(async () =>
    root!.render(
      createElement(VoiceSetupRow, { setup, settings: loadVoiceSettings(), change: vi.fn() }),
    ),
  );
  return setup;
}
const button = (label: string) =>
  [...container.querySelectorAll("button")].find((el) => el.textContent === label);
const primaries = () =>
  [...container.querySelectorAll("button")]
    .filter((el) => el.className.includes("primary") || el.dataset.variant === "primary")
    .map((el) => el.textContent);

it("makes Install the only primary action when Python is present", async () => {
  await render({});
  expect(button("Install")).toBeDefined();
  expect(button("Get Python")).toBeUndefined();
  expect(primaries()).toEqual(["Install"]);
});

it("makes Get Python the only primary action and offers no Install when Python is missing", async () => {
  const setup = await render({ pythonMissing: true });
  expect(button("Get Python")).toBeDefined();
  expect(button("Install")).toBeUndefined();
  expect(setup.install).not.toHaveBeenCalled();
  expect(primaries()).toEqual(["Get Python"]);
});

it("offers Locate files directly, with no menu and one retry on failure", async () => {
  const setup = await render({
    visibleError: { message: "This computer is unavailable. Try again." },
    setupError: true,
    check: vi.fn(),
    resetJob: vi.fn(),
    setLocating: vi.fn(),
  });
  expect(container.querySelector('[aria-haspopup="menu"]')).toBeNull();
  expect(button("Check again")).toBeUndefined();
  expect(button("Try again")).toBeDefined();
  act(() => button("Locate files")!.click());
  expect(setup.setLocating).toHaveBeenCalledExactlyOnceWith(true);
});

it("hides Locate files once setup is ready", async () => {
  await render({ ready: true, message: "Voice is ready" });
  expect(button("Locate files")).toBeUndefined();
  expect(button("Install")).toBeUndefined();
});

it("keeps the Locate dialog to its fields and close", async () => {
  await render({
    locating: true,
    browsing: null,
    closeLocate: vi.fn(),
  });
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Python");
  const buttons = [...dialog.querySelectorAll("button")].map((el) => el.textContent?.trim());
  expect(buttons).not.toContain("Done");
  expect(buttons).not.toContain("Automatic detection");
});
