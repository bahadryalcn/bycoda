// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { notify, speak } = vi.hoisted(() => ({
  notify: vi.fn(async () => true),
  speak: vi.fn(async () => undefined),
}));
vi.mock("../../notifications", () => ({ notifyAssistant: notify }));
vi.mock("../model/voiceBriefingPlayback", () => ({ previewBriefing: speak }));
import { useVoiceReturnCall } from "./useVoiceReturnCall";
import type { VoiceSettings } from "../model/voiceSettings";

type Hook = Parameters<typeof useVoiceReturnCall>[0];
const profile = {
  name: "Arif",
  language: "en",
  quietStart: 0,
  quietEnd: 0,
  setupComplete: true,
  voiceSetupComplete: true,
};
let root: Root;
let result: ReturnType<typeof useVoiceReturnCall>;
let status = "ready";
const start = vi.fn(async () => {
  status = "live";
});
const stopToReady = vi.fn();

let inputs: { patch: Partial<Hook>; settings: Partial<VoiceSettings> } = {
  patch: {},
  settings: {},
};
function Fixture(_: { tick: number }) {
  result = useVoiceReturnCall({
    settings: { returnCall: true, returnCallSeconds: 10, ...inputs.settings } as VoiceSettings,
    snapshot: { profile, presence: { state: "present" } } as never,
    capturePresence: "active",
    status,
    muted: false,
    speakerMuted: false,
    available: true,
    lastAdmittedSpeechAt: null,
    briefingDelivering: () => false,
    start,
    stopToReady,
    setPlayback: vi.fn(),
    ...inputs.patch,
  });
  return null;
}
let tick = 0;
function mount(patch: Partial<Hook>, settings: Partial<VoiceSettings> = {}) {
  inputs = { patch, settings };
  return act(async () => root.render(createElement(Fixture, { tick: ++tick })));
}
const away = (extra: Partial<Hook> = {}, settings: Partial<VoiceSettings> = {}) =>
  mount({ capturePresence: "away", ...extra }, settings);
const back = (extra: Partial<Hook> = {}, settings: Partial<VoiceSettings> = {}) =>
  mount({ capturePresence: "active", ...extra }, settings);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  status = "ready";
  for (const mock of [notify, speak, start, stopToReady]) mock.mockClear();
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});

it("does nothing on return while the setting is off", async () => {
  await away({}, { returnCall: false });
  await back({}, { returnCall: false });
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(speak).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
});

it("speaks, opens capture, then shows a notice and notifies when nobody answers", async () => {
  await away();
  await back();
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(speak).toHaveBeenCalledOnce();
  expect(start).toHaveBeenCalledOnce();
  await back({ status: "live" });
  await act(async () => vi.advanceTimersByTimeAsync(200));
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(stopToReady).toHaveBeenCalledOnce();
  expect(result.notice).toBe("I called you but you didn't answer.");
  expect(notify).toHaveBeenCalledWith(
    expect.objectContaining({ body: "I called you but you didn't answer.", title: "Arif" }),
  );
});

it("keeps the conversation when accepted speech arrives in the window", async () => {
  await away();
  await back();
  await act(async () => vi.advanceTimersByTimeAsync(0));
  await back({ status: "live" });
  await act(async () => vi.advanceTimersByTimeAsync(200));
  await back({ status: "live", lastAdmittedSpeechAt: Date.now() });
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(stopToReady).not.toHaveBeenCalled();
  expect(notify).not.toHaveBeenCalled();
  expect(result.notice).toBe("");
});

it.each([
  ["do not disturb", { snapshot: { profile, presence: { state: "dnd" } } as never }],
  ["quiet hours", { snapshot: { profile: { ...profile, quietStart: 0, quietEnd: 24 } } as never }],
  ["muted", { muted: true }],
])("stays silent for %s", async (_name, patch) => {
  await away();
  await back(patch as Partial<Hook>);
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(speak).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
});

it("a disconnect during the greeting cancels the call", async () => {
  let release!: () => void;
  speak.mockImplementationOnce(
    () => new Promise<undefined>((resolve) => (release = () => resolve(undefined))),
  );
  await away();
  await back();
  await back({ status: "idle" });
  release();
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(start).not.toHaveBeenCalled();
});
