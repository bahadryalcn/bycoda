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
import * as activity from "../model/dictationActivity";

let root: Root | undefined;
let element: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  element?.remove();
  localStorage.clear();
  vi.clearAllMocks();
});

it("binds the default dictation shortcut only to its focused composer without taking Split Down", async () => {
  saveVoiceSettings({
    ...loadVoiceSettings(),
    dictationEnabled: true,
    dictationShortcutMode: "toggle",
  });
  const editor = document.createElement("textarea");
  document.body.append(editor);
  try {
    await render({ editorRef: { current: editor }, projectId: "project-a" });
    const press = (key: string) =>
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          code: `Key${key.toUpperCase()}`,
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    await act(async () => {
      press("m");
    });
    expect(mock.start).not.toHaveBeenCalled();
    editor.focus();
    await act(async () => {
      press("d");
    });
    expect(mock.start).not.toHaveBeenCalled();
    await act(async () => {
      press("m");
    });
    expect(mock.start).toHaveBeenCalledOnce();
    expect(mock.args[5]).toMatchObject({ projectId: "project-a" });
  } finally {
    editor.remove();
  }
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

it("uses its own setting independently of the voice companion", async () => {
  const { button } = await render();
  expect(button()).toBeNull();
  await act(async () => saveVoiceSettings({ ...loadVoiceSettings(), enabled: true }));
  expect(button()).toBeNull();
  await act(async () =>
    saveVoiceSettings({ ...loadVoiceSettings(), enabled: false, dictationEnabled: true }),
  );
  expect(button()?.getAttribute("aria-label")).toBe("Dictate");
});

it("cancels active dictation only when its own setting is disabled", async () => {
  saveVoiceSettings({ ...loadVoiceSettings(), enabled: true, dictationEnabled: true });
  const { button } = await render();
  await act(async () => button()!.click());
  await act(async () => saveVoiceSettings({ ...loadVoiceSettings(), enabled: false }));
  expect(button()).not.toBeNull();
  expect(mock.cancel).not.toHaveBeenCalled();
  await act(async () => saveVoiceSettings({ ...loadVoiceSettings(), dictationEnabled: false }));
  expect(button()).toBeNull();
  expect(mock.cancel).toHaveBeenCalledOnce();
});

it("shows dictation for an existing enabled voice preference", async () => {
  localStorage.setItem("bycoda.voice", JSON.stringify({ enabled: true }));
  const { button } = await render();
  expect(button()?.getAttribute("aria-label")).toBe("Dictate");
});

it("shows dictation after explicitly enabling it", async () => {
  const { button } = await render();
  await act(async () => saveVoiceSettings({ ...loadVoiceSettings(), dictationEnabled: true }));
  expect(button()?.getAttribute("aria-label")).toBe("Dictate");
});

it("toggles local dictation and hands recognized phrases to the composer", async () => {
  saveVoiceSettings({ ...loadVoiceSettings(), dictationEnabled: true, natural: false });
  const { onText, onError, button } = await render();
  await act(async () => button()!.click());
  expect(mock.start).toHaveBeenCalledOnce();
  expect(mock.args[1]).toMatchObject({ natural: false });
  expect(mock.args[3]).toBe("local");
  await act(async () => mock.callbacks.state("listening"));
  expect(button()?.getAttribute("aria-pressed")).toBe("true");
  expect(button()?.getAttribute("aria-label")).toBe("Stop dictation");
  mock.callbacks.text("Merhaba", false);
  mock.callbacks.text("Merhaba dünya", true);
  // Both calls carry the same dictation run, so the preview is replaced in place.
  const [[, preview, run], [, final, sameRun]] = onText.mock.calls;
  expect([preview, final]).toEqual([false, true]);
  expect(sameRun).toBe(run);
  mock.callbacks.error("Speech recognition failed. Please try again.");
  expect(onError).toHaveBeenCalledWith("Speech recognition failed. Please try again.");
  await act(async () => button()!.click());
  expect(mock.stop).toHaveBeenCalledOnce();
});

it("uses an explicitly selected local model only for dictation", async () => {
  saveVoiceSettings({
    ...loadVoiceSettings(),
    dictationEnabled: true,
    whisperPath: "legacy/automatic",
    dictationLocalModelPath: "owned/small",
  });
  expect(loadVoiceSettings().dictationLocalModelPath).toBe("owned/small");
  const { button } = await render();
  await act(async () => button()!.click());
  expect(mock.args[1]).toMatchObject({ whisperPath: "owned/small", whisperExact: true });
});

it("cancels dictation when the composer becomes unavailable", async () => {
  saveVoiceSettings({ ...loadVoiceSettings(), dictationEnabled: true });
  await render();
  await act(async () => element.querySelector("button")!.click());
  await act(async () =>
    root!.render(
      createElement(DictationButton, { onText: vi.fn(), onError: vi.fn(), disabled: true }),
    ),
  );
  expect(mock.cancel).toHaveBeenCalled();
});

it("keeps preparation cancellable and lets a click cancel a stuck transcription", async () => {
  saveVoiceSettings({ ...loadVoiceSettings(), dictationEnabled: true });
  const { button } = await render();
  await act(async () => button()!.click());
  await act(async () => mock.callbacks.state("starting"));
  expect(button()?.getAttribute("aria-label")).toBe("Preparing dictation…");
  expect(button()?.getAttribute("aria-busy")).toBe("true");
  expect(button()?.getAttribute("aria-disabled")).not.toBe("true");
  await act(async () => button()!.click());
  expect(mock.stop).toHaveBeenCalledOnce();
  await act(async () => mock.callbacks.state("finishing"));
  expect(button()?.getAttribute("aria-label")).toBe("Cancel transcription");
  expect(button()?.getAttribute("aria-disabled")).not.toBe("true");
  expect(mock.cancel).not.toHaveBeenCalled();
  await act(async () => button()!.click());
  expect(mock.stop).toHaveBeenCalledOnce();
  expect(mock.cancel).toHaveBeenCalledOnce();
  await act(async () => mock.callbacks.state("idle"));
  expect(button()?.getAttribute("aria-label")).toBe("Dictate");
  expect(button()?.getAttribute("aria-busy")).toBeNull();
});

it("responds to microphone level, resets on stop, and ignores an old capture", async () => {
  saveVoiceSettings({ ...loadVoiceSettings(), dictationEnabled: true });
  const { button } = await render();
  await act(async () => button()!.click());
  const old = mock.callbacks;
  await act(async () => old.state("listening"));
  const visual = () => button()!.querySelector<HTMLElement>("[data-state]")!;
  expect(visual().getAttribute("aria-hidden")).toBe("true");
  old.level(0.1);
  expect(Number(visual().style.getPropertyValue("--dictation-level"))).toBeCloseTo(0.7);
  old.level(2);
  expect(visual().style.getPropertyValue("--dictation-level")).toBe("1");
  old.level(-1);
  expect(visual().style.getPropertyValue("--dictation-level")).toBe("0");
  old.level(0.1);
  await act(async () => old.state("finishing"));
  expect(visual().style.getPropertyValue("--dictation-level")).toBe("0");
  await act(async () => old.state("idle"));
  await act(async () => button()!.click());
  await act(async () => mock.callbacks.state("listening"));
  old.level(1);
  await act(async () => old.state("finishing"));
  expect(button()?.getAttribute("data-dictation-state")).toBe("listening");
  expect(visual().style.getPropertyValue("--dictation-level")).toBe("0");
});

it("starts dictation with the chosen cloud recognizer and model", async () => {
  saveVoiceSettings({
    ...loadVoiceSettings(),
    dictationEnabled: true,
    dictationEngine: "openai",
    dictationModels: { openai: "whisper-1" },
  });
  const { button } = await render();
  await act(async () => button()!.click());
  expect(mock.args.slice(3, 5)).toEqual(["openai", "whisper-1"]);
  expect(mock.args[5]).toMatchObject({ dictionary: [], removeFillers: false });
});

it("reports its run with the session and whether its message box is on screen", async () => {
  let observed!: (entries: { isIntersecting: boolean }[]) => void;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: typeof observed) {
        observed = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  saveVoiceSettings({ ...loadVoiceSettings(), dictationEnabled: true });
  const runs: unknown[][] = [];
  const spy = vi.spyOn(activity, "reportDictation").mockImplementation((...args) => {
    runs.push(args);
  });
  const { button } = await render({ sessionId: "s1" });
  await act(async () => button()!.click());
  await act(async () => mock.callbacks.state("listening"));
  expect(runs.at(-1)?.[1]).toMatchObject({ sessionId: "s1", state: "listening", visible: true });
  await act(async () => observed([{ isIntersecting: false }]));
  expect(runs.at(-1)?.[1]).toMatchObject({ visible: false });
  (runs.at(-1)![1] as { stop: () => void }).stop();
  expect(mock.stop).toHaveBeenCalledOnce();
  await act(async () => mock.callbacks.state("idle"));
  expect(runs.at(-1)?.[1]).toBeUndefined();
  spy.mockRestore();
  vi.unstubAllGlobals();
});

it("chooses the dictation language from the composer and disables options while listening", async () => {
  saveVoiceSettings({ ...loadVoiceSettings(), dictationEnabled: true, dictationEngine: "xai" });
  await render();
  const options = () =>
    element.querySelector<HTMLButtonElement>('button[aria-label="Dictation options"]')!;
  const item = (name: string) =>
    [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find((row) =>
      row.textContent?.includes(name),
    );
  await act(async () => options().click());
  await act(async () => item("Dictation language")!.click());
  await act(async () => item("Türkçe")!.click());
  expect(loadVoiceSettings().dictationLanguage).toBe("tr");
  expect(item("Türkçe")).toBeUndefined();
  await act(async () => element.querySelector("button")!.click());
  await act(async () => mock.callbacks.state("listening"));
  expect(mock.args[0]).toBe("tr");
  expect(options().disabled).toBe(true);
});

it("joins the microphone and its options in one group and marks each recognizer", async () => {
  saveVoiceSettings({ ...loadVoiceSettings(), dictationEnabled: true });
  await render();
  const group = element.querySelector('[role="group"][data-button-group="joined"]')!;
  expect(group.getAttribute("aria-label")).toBe("Dictation");
  expect(
    [...group.querySelectorAll("button")].map((button) => button.getAttribute("aria-label")),
  ).toEqual(["Dictate", "Dictation options"]);
  const item = (name: string) =>
    [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find((row) =>
      row.textContent?.includes(name),
    )!;
  await act(async () => group.querySelectorAll("button")[1].click());
  await act(async () => item("Dictation recognition").click());
  for (const name of ["This computer", "OpenAI", "Grok", "OpenRouter"])
    expect(item(name).querySelector("svg, img"), name).not.toBeNull();
});
