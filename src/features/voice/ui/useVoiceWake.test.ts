// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  presence: "active" as string,
  inspect: vi.fn(),
  close: vi.fn(),
  closeRecognizer: vi.fn(),
  recognize: vi.fn(),
  open: vi.fn(),
}));
vi.mock("../model/voicePresence", () => ({ useVoicePresence: () => mocks.presence }));
vi.mock("../model/localVoiceClient", () => ({ localVoiceBackend: { inspect: mocks.inspect } }));
vi.mock("../model/voiceWakeAdapters", () => ({
  localWakeDeps: () => ({
    openCapture: mocks.open,
    recognize: mocks.recognize,
    closeRecognizer: mocks.closeRecognizer,
  }),
}));
import { claimVoiceConversationActivity } from "../model/voiceActivity";
import { loadVoiceSettings } from "../model/voiceSettings";
import { useVoiceWake } from "./useVoiceWake";
import { VOICE_WAKE_EVENT } from "./useVoiceTalkEvent";

const voiced = () =>
  Int16Array.from({ length: 1024 }, (_, i) =>
    Math.round(4000 * Math.sin((2 * Math.PI * 150 * i) / 16000)),
  );
let onFrame: (frame: Int16Array) => void;
const profile = { name: "Arif", language: "en-US" };
const talk = vi.fn();
let root: ReturnType<typeof createRoot>;
let seen: ReturnType<typeof useVoiceWake>;
function Fixture(props: { wakeEnabled?: boolean; manualPresence?: string }) {
  seen = useVoiceWake({
    settings: { ...loadVoiceSettings(), wakeEnabled: props.wakeEnabled ?? true },
    profile,
    manualPresence: props.manualPresence,
  });
  return null;
}
const render = (props: Parameters<typeof Fixture>[0] = {}) =>
  act(async () => root.render(createElement(Fixture, props)));
const speak = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) onFrame(voiced());
    for (let i = 0; i < 40; i++) onFrame(new Int16Array(1024));
  });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.presence = "active";
  mocks.inspect.mockResolvedValue({ missing: [], ready: true });
  mocks.open.mockImplementation(async (callback) => {
    onFrame = callback;
    return { rate: 16000, close: mocks.close };
  });
  root = createRoot(document.createElement("div"));
  window.addEventListener(VOICE_WAKE_EVENT, talk);
});
afterEach(async () => {
  window.removeEventListener(VOICE_WAKE_EVENT, talk);
  await act(async () => root.unmount());
  vi.clearAllMocks();
  localStorage.clear();
});

it("does not listen unless the owner enabled the wake phrase", async () => {
  await render({ wakeEnabled: false });
  expect(mocks.open).not.toHaveBeenCalled();
  expect(seen.indicator).toBeNull();
});

it("listens with a visible indicator and stops while a conversation is live", async () => {
  await render();
  await vi.waitFor(() => expect(seen.indicator).toEqual({ kind: "listening", phrase: "Hey Arif" }));
  let release!: () => void;
  await act(async () => {
    release = claimVoiceConversationActivity();
  });
  expect(mocks.close).toHaveBeenCalledTimes(1);
  expect(seen.indicator).toBeNull();
  await act(async () => release());
  await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledTimes(2));
});

it.each([
  ["locked or away", () => (mocks.presence = "away"), undefined],
  ["unknown", () => (mocks.presence = "unknown"), undefined],
  ["manual Do not disturb", () => undefined, "dnd"],
  ["manual Away", () => undefined, "away"],
])("never listens while %s", async (_name, setup, manualPresence) => {
  setup();
  await render({ manualPresence });
  expect(mocks.open).not.toHaveBeenCalled();
});

it("stops when the desktop locks", async () => {
  await render();
  await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledTimes(1));
  mocks.presence = "away";
  await render();
  expect(mocks.close).toHaveBeenCalledTimes(1);
  expect(seen.indicator).toBeNull();
});

it("shows the voice pack notice without opening the microphone when recognition is missing", async () => {
  mocks.inspect.mockResolvedValue({ missing: ["faster-whisper"], ready: false });
  await render();
  await vi.waitFor(() => expect(seen.indicator).toEqual({ kind: "pack" }));
  expect(mocks.open).not.toHaveBeenCalled();
});

it("starts Talk once on a match, with the capture already released", async () => {
  mocks.recognize.mockResolvedValue("hey arif");
  await render();
  await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledTimes(1));
  await speak();
  await vi.waitFor(() => expect(talk).toHaveBeenCalledTimes(1));
  expect(mocks.close).toHaveBeenCalledTimes(1);
  // Handoff: the listener does not reopen the microphone while Talk takes over.
  await render();
  expect(mocks.open).toHaveBeenCalledTimes(1);
  expect(talk).toHaveBeenCalledTimes(1);
});

it("turns the feature off in one click", async () => {
  await render();
  seen.turnOff();
  expect(loadVoiceSettings().wakeEnabled).toBeUndefined();
});
