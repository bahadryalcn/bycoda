import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  VoiceReturnCall,
  mayCallOnReturn,
  voiceReturnCallWindowMs,
  type VoiceReturnCallPorts,
  type VoiceReturnCallState,
} from "./voiceReturnCall";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const state = (patch: Partial<VoiceReturnCallState> = {}): VoiceReturnCallState => ({
  enabled: true,
  available: true,
  profile: { quietStart: 22, quietEnd: 7, setupComplete: true, voiceSetupComplete: true },
  presence: "active",
  status: "ready",
  muted: false,
  speakerMuted: false,
  hour: 12,
  ...patch,
});

test("the window setting is clamped to 5 to 120 seconds with a 20 second default", () => {
  expect(voiceReturnCallWindowMs(undefined)).toBe(20_000);
  expect(voiceReturnCallWindowMs(1)).toBe(5_000);
  expect(voiceReturnCallWindowMs(500)).toBe(120_000);
  expect(voiceReturnCallWindowMs(45)).toBe(45_000);
});

test.each<[string, Partial<VoiceReturnCallState>, boolean]>([
  ["off by default", { enabled: false }, false],
  ["all clear", {}, true],
  ["quiet hours", { hour: 23 }, false],
  ["early quiet hours", { hour: 3 }, false],
  ["do not disturb", { manualPresence: "dnd" }, false],
  ["away", { manualPresence: "away" }, false],
  ["muted", { muted: true }, false],
  ["speaker muted", { speakerMuted: true }, false],
  ["not ready", { status: "sleeping" }, false],
  ["not active", { presence: "idle" }, false],
  ["unconfigured", { profile: null }, false],
  ["voice unavailable", { available: false }, false],
])("mayCallOnReturn: %s", (_name, patch, expected) =>
  expect(mayCallOnReturn(state(patch))).toBe(expected),
);

function ports(over: Partial<VoiceReturnCallPorts> = {}) {
  const calls: string[] = [];
  const value: VoiceReturnCallPorts = {
    eligible: () => true,
    greet: async () => void calls.push("greet"),
    open: async () => (calls.push("open"), true),
    close: () => void calls.push("close"),
    missed: () => void calls.push("missed"),
    ...over,
  };
  return { calls, call: new VoiceReturnCall(value, () => 20_000) };
}

test("speaks, opens capture, and reports a missed call after the window", async () => {
  const { calls, call } = ports();
  await call.begin();
  expect(calls).toEqual(["greet", "open"]);
  await vi.advanceTimersByTimeAsync(19_999);
  expect(calls).toEqual(["greet", "open"]);
  await vi.advanceTimersByTimeAsync(1);
  expect(calls).toEqual(["greet", "open", "close", "missed"]);
  expect(call.busy).toBe(false);
});

test("accepted speech inside the window continues the conversation", async () => {
  const { calls, call } = ports();
  await call.begin();
  call.answered();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(calls).toEqual(["greet", "open"]);
});

test("speech during the greeting is not an answer and ineligible calls do nothing", async () => {
  const early = ports();
  const started = early.call.begin();
  early.call.answered();
  await started;
  await vi.advanceTimersByTimeAsync(20_000);
  expect(early.calls).toContain("missed");
  const off = ports({ eligible: () => false });
  await off.call.begin();
  expect(off.calls).toEqual([]);
});

test("losing eligibility during the greeting opens no capture", async () => {
  let eligible = true;
  const { calls, call } = ports({
    greet: async () => {
      calls.push("greet");
      eligible = false;
    },
    eligible: () => eligible,
  });
  await call.begin();
  expect(calls).toEqual(["greet"]);
});

test("cancel fences the greeting, a pending open and the window timer", async () => {
  let release!: () => void;
  const slow = ports({ greet: () => new Promise<void>((resolve) => (release = resolve)) });
  const started = slow.call.begin();
  slow.call.cancel();
  release();
  await started;
  expect(slow.calls).toEqual([]);
  const listening = ports();
  await listening.call.begin();
  listening.call.cancel();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(listening.calls).toEqual(["greet", "open"]);
});

test("a failed greeting or open ends quietly without a missed notice", async () => {
  const bad = ports({
    greet: async () => {
      throw new Error("tts");
    },
  });
  await bad.call.begin();
  const closed = ports({ open: async () => false });
  await closed.call.begin();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(bad.calls).toEqual([]);
  expect(closed.calls).toEqual(["greet"]);
});
