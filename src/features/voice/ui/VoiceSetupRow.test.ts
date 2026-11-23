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
