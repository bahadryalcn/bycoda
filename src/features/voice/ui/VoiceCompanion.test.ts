// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { Session } from "../../sessions/model/session";
const mock = vi.hoisted(() => ({
  callbacks: null as any,
  close: vi.fn(),
  speak: vi.fn(() => true),
  converse: vi.fn(async () => ({ action: "submit", reply: "" })),
  connect: vi.fn(async () => {}),
  warm: vi.fn(async () => {}),
}));
vi.mock("../model/localVoice", () => ({
  LocalVoice: class {
    constructor(callbacks: unknown) {
      mock.callbacks = callbacks;
    }
    connect = mock.connect;
    close = mock.close;
    speak = mock.speak;
    mute() {}
    silence() {}
  },
}));
vi.mock("../model/voiceConversation", () => ({
  converseWithSession: mock.converse,
  warmVoiceReply: mock.warm,
}));
vi.mock("../../sessions/model/sessionsStore", () => ({
  sessionsRef: { current: [] },
  useSession: () => undefined,
}));
vi.mock("../../../shared/i18n", () => ({
  t: (key: string) => key,
  useT: () => (key: string) => key,
  useLocale: () => "tr",
}));
import { VoiceCompanion } from "./VoiceCompanion";
let root: Root, container: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
});
const a = { id: "a", title: "Alpha", cwd: "/a", blocks: [], busy: true } as unknown as Session;
const b = { id: "b", title: "Beta", cwd: "/b", blocks: [] } as unknown as Session;
async function setup() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const onSubmit = vi.fn(() => true),
    onStop = vi.fn();
  const render = async (activeId: string, sessions = [a, b]) =>
    act(async () =>
      root.render(createElement(VoiceCompanion, { activeId, sessions, onSubmit, onStop })),
    );
  await render("a");
  await click("Voice companion");
  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Start voice"))!
      .click();
  });
  return { render, onSubmit, onStop };
}
async function click(label: string) {
  await act(async () =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click(),
  );
}
async function speech(text: string, binding?: any) {
  let turn = binding;
  if (!turn)
    await act(async () => {
      turn = mock.callbacks.start();
    });
  await act(async () =>
    mock.callbacks.transcript({ text, language: "tr", inferenceMs: 150 }, turn),
  );
  return turn;
}
it("captures the target at local speech onset and follows only the next utterance", async () => {
  const { render, onSubmit } = await setup();
  let binding: any;
  await act(async () => {
    binding = mock.callbacks.start();
  });
  await render("b");
  await speech("Fix login", binding);
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith("a", "Fix login");
  await speech("Fix login", binding);
  expect(onSubmit).toHaveBeenCalledTimes(1);
  await speech("Fix filter");
  expect(onSubmit).toHaveBeenLastCalledWith("b", "Fix filter");
});
it("pins the session and closing voice leaves the coding job running", async () => {
  const { render, onSubmit, onStop } = await setup();
  await click("Pin to this session");
  await render("b");
  await speech("Fix login");
  expect(onSubmit).toHaveBeenCalledWith("a", "Fix login");
  await click("Close voice companion");
  expect(mock.close).toHaveBeenCalled();
  expect(onStop).not.toHaveBeenCalled();
});
it("closes with Escape and restores launcher focus without stopping coding", async () => {
  const { onStop } = await setup();
  const panel = container.querySelector('section[aria-label="Voice companion"]')!;
  await act(async () =>
    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(container.querySelector('section[aria-label="Voice companion"]')).toBeNull();
  expect(document.activeElement).toBe(
    container.querySelector('button[aria-label="Voice companion"]'),
  );
  expect(mock.close).toHaveBeenCalled();
  expect(onStop).not.toHaveBeenCalled();
});
it("answers while the job is busy without submitting the question", async () => {
  mock.converse.mockResolvedValueOnce({ action: "reply", reply: "Still working." });
  mock.warm.mockClear();
  const { onSubmit } = await setup();
  // Warmed on start; a reply consumes the warm process, so it is warmed again.
  expect(mock.warm).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  const warmed = mock.warm.mock.calls.length;
  await speech("What are you working on?");
  expect(mock.warm.mock.calls.length).toBeGreaterThan(warmed);
  expect(mock.speak).toHaveBeenCalledWith("Still working.", false);
  expect(onSubmit).not.toHaveBeenCalled();
});
it("speaks a streamed reply from its first sentence and shows it progressively", async () => {
  let finish!: (value: unknown) => void;
  let sentence!: (text: string) => void;
  mock.converse.mockImplementationOnce(
    (_session: unknown, _text: unknown, _history: unknown, _signal: unknown, onSentence: any) =>
      new Promise((done) => {
        sentence = onSentence;
        finish = done;
      }),
  );
  const { onSubmit } = await setup();
  await speech("Unit test nedir?");
  await act(async () => sentence("Kısa cevap şu."));
  expect(mock.speak).toHaveBeenLastCalledWith("Kısa cevap şu.", false);
  expect(container.textContent).toContain("Kısa cevap şu.");
  await act(async () => sentence("İkinci cümle."));
  expect(mock.speak).toHaveBeenLastCalledWith("İkinci cümle.", true);
  expect(container.textContent).toContain("Kısa cevap şu. İkinci cümle.");
  const spoken = mock.speak.mock.calls.length;
  await act(async () => finish({ action: "reply", reply: "Kısa cevap şu. İkinci cümle." }));
  // Already spoken while streaming: the final reply is not repeated.
  expect(mock.speak.mock.calls.length).toBe(spoken);
  expect(onSubmit).not.toHaveBeenCalled();
});
it("does not claim acceptance when submission was rejected", async () => {
  const { onSubmit } = await setup();
  onSubmit.mockReturnValue(false);
  await speech("Fix login");
  expect(mock.speak).toHaveBeenCalledWith(
    "The request was not accepted. Check the session.",
    false,
  );
});
it("discards a pending side reply when a newer utterance starts", async () => {
  let resolve!: (value: any) => void;
  mock.converse.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { onSubmit } = await setup();
  await speech("old request");
  await act(async () => {
    mock.callbacks.start();
  });
  await act(async () => resolve({ action: "submit", reply: "" }));
  expect(onSubmit).not.toHaveBeenCalled();
});
it("announces the end of tracked work without invoking another agent", async () => {
  const { render } = await setup();
  await speech("Fix login");
  mock.speak.mockClear();
  await render("b", [
    {
      ...a,
      busy: false,
      blocks: [{ id: "done", role: "assistant", text: "Changes ready for review." }],
    },
    b,
  ]);
  expect(mock.speak).toHaveBeenCalledWith(
    expect.stringContaining("Changes ready for review."),
    false,
  );
  expect(mock.converse).toHaveBeenCalledTimes(1);
});

it("keeps voice running through compact mode, live appearance updates and expansion", async () => {
  const { saveVoiceSettings, loadVoiceSettings } = await import("../model/voiceSettings");
  const { onStop } = await setup();
  await click("Compact voice companion");
  expect(loadVoiceSettings().compact).toBe(true);
  expect(container.querySelector("section")?.getAttribute("data-compact")).toBe("true");
  expect(mock.close).not.toHaveBeenCalled();
  await act(async () => saveVoiceSettings({ ...loadVoiceSettings(), visual: "dots" }));
  expect(container.querySelector('[data-visual="dots"]')).not.toBeNull();
  await click("Expand voice companion");
  expect(loadVoiceSettings().compact).toBe(false);
  expect(mock.close).not.toHaveBeenCalled();
  expect(onStop).not.toHaveBeenCalled();
});
it("uses playback events rather than reply text to announce assistant speech", async () => {
  await setup();
  await act(async () => mock.callbacks.playback(true));
  expect(container.querySelector("section")?.getAttribute("data-voice-state")).toBe("assistant");
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Assistant speaking");
  await act(async () => mock.callbacks.playback(false));
  expect(container.querySelector("section")?.getAttribute("data-voice-state")).toBe("listening");
  await act(async () => mock.callbacks.error("Playback failed"));
  expect(container.querySelector("section")?.getAttribute("data-voice-state")).toBe("error");
});

it("shows the Host's reason when local voice start is rejected with a string", async () => {
  mock.connect.mockRejectedValueOnce("Voice setup is still running.");
  await setup();
  expect(container.textContent).toContain("Voice setup is still running.");
  expect(container.textContent).not.toContain("Local voice could not start.");
});
