// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  callbacks: null as any,
  start: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
  cancel: vi.fn(),
  args: [] as unknown[],
}));
vi.mock("../model/dictation", () => ({
  Dictation: class {
    constructor(callbacks: unknown, ...args: unknown[]) {
      mock.callbacks = callbacks;
      mock.args = args;
    }
    start = mock.start;
    stop = mock.stop;
    cancel = mock.cancel;
  },
}));
import { DictationButton } from "./DictationButton";
import { loadVoiceSettings, saveVoiceSettings } from "../model/voiceSettings";

let root: Root | undefined;
let element: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  element?.remove();
  localStorage.clear();
  vi.clearAllMocks();
});
async function render(props: Partial<Parameters<typeof DictationButton>[0]> = {}) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  const onText = vi.fn();
  const onError = vi.fn();
  await act(async () =>
    root!.render(createElement(DictationButton, { onText, onError, ...props })),
  );
  return { onText, onError, button: () => element.querySelector("button") };
}

it("is absent until voice is enabled in settings", async () => {
  const { button } = await render();
  expect(button()).toBeNull();
  await act(async () => saveVoiceSettings({ ...loadVoiceSettings(), enabled: true }));
  expect(button()?.getAttribute("aria-label")).toBe("Dictate");
});

it("toggles local dictation and hands recognized phrases to the composer", async () => {
  saveVoiceSettings({ ...loadVoiceSettings(), enabled: true, natural: false });
  const { onText, onError, button } = await render();
  await act(async () => button()!.click());
  expect(mock.start).toHaveBeenCalledOnce();
  expect(mock.args[1]).toMatchObject({ natural: false });
  await act(async () => mock.callbacks.state("listening"));
  expect(button()?.getAttribute("aria-pressed")).toBe("true");
  expect(button()?.getAttribute("aria-label")).toBe("Stop dictation");
  mock.callbacks.text("Merhaba dünya");
  expect(onText).toHaveBeenCalledWith("Merhaba dünya");
  mock.callbacks.error("Speech recognition failed. Please try again.");
  expect(onError).toHaveBeenCalledWith("Speech recognition failed. Please try again.");
  await act(async () => button()!.click());
  expect(mock.stop).toHaveBeenCalledOnce();
});

it("cancels dictation when the composer becomes unavailable", async () => {
  saveVoiceSettings({ ...loadVoiceSettings(), enabled: true });
  await render();
  await act(async () => element.querySelector("button")!.click());
  await act(async () =>
    root!.render(
      createElement(DictationButton, { onText: vi.fn(), onError: vi.fn(), disabled: true }),
    ),
  );
  expect(mock.cancel).toHaveBeenCalled();
});
