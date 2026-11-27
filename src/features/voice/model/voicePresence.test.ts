// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import {
  classifyVoicePresence,
  deriveCapturePresence,
  markAcceptedVoiceSpeech,
  readNativeVoicePresence,
  subscribeVoicePresence,
} from "./voicePresence";
import {
  resetVoiceActivityForTest,
  takeVoiceActivityReport,
} from "../../../shared/lib/voiceActivity";
afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  vi.resetAllMocks();
});
it("returns unknown for a hung native read and accepts a fresh later sample", async () => {
  vi.useFakeTimers();
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  invoke.mockImplementationOnce(() => new Promise(() => {}));
  const pending = readNativeVoicePresence(10);
  await vi.advanceTimersByTimeAsync(3001);
  expect(await pending).toBe("unknown");
  invoke.mockResolvedValue({ idleMs: 0, locked: false, supported: true });
  expect(await readNativeVoicePresence(10)).toBe("active");
});
it("requires fresh supported native presence for an explicit Away/DND capture override", async () => {
  expect(await readNativeVoicePresence(10)).toBe("unknown");
  expect(invoke).not.toHaveBeenCalled();
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  invoke
    .mockResolvedValueOnce({ idleMs: 0, locked: false, supported: false })
    .mockResolvedValueOnce({ idleMs: 0, locked: true, supported: true })
    .mockResolvedValueOnce({ idleMs: 0, locked: false, supported: true })
    .mockRejectedValueOnce(new Error("native unavailable"));
  expect(await readNativeVoicePresence(10)).toBe("unknown");
  expect(await readNativeVoicePresence(10)).toBe("away");
  expect(await readNativeVoicePresence(10)).toBe("active");
  expect(await readNativeVoicePresence(10)).toBe("unknown");
  expect(invoke.mock.calls.every(([method]) => method === "get_user_presence")).toBe(true);
});

it("shares one native poll per threshold and stops it when the last consumer leaves", async () => {
  vi.useFakeTimers();
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  invoke.mockResolvedValue({ idleMs: 0, locked: false, supported: true });
  const first = vi.fn();
  const second = vi.fn();
  const leaveFirst = subscribeVoicePresence(10, first);
  const leaveSecond = subscribeVoicePresence(10, second);
  await vi.advanceTimersByTimeAsync(0);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(first).toHaveBeenLastCalledWith("active");
  expect(second).toHaveBeenLastCalledWith("active");
  await vi.advanceTimersByTimeAsync(5000);
  expect(invoke).toHaveBeenCalledTimes(2);
  leaveFirst();
  await vi.advanceTimersByTimeAsync(5001);
  expect(invoke).toHaveBeenCalledTimes(3);
  leaveSecond();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(invoke).toHaveBeenCalledTimes(3);
});

it("keeps polling native presence while the page is hidden for background wake listening", async () => {
  vi.useFakeTimers();
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  invoke.mockResolvedValue({ idleMs: 0, locked: true, supported: true });
  const listener = vi.fn();
  const leave = subscribeVoicePresence(10, listener);
  await vi.advanceTimersByTimeAsync(0);
  expect(listener).toHaveBeenLastCalledWith("away");
  await vi.advanceTimersByTimeAsync(5000);
  expect(invoke).toHaveBeenCalledTimes(2);
  leave();
  Reflect.deleteProperty(document, "visibilityState");
});

describe("computer presence admission", () => {
  it("does not infer activity from unsupported or failed measurements", () => {
    expect(classifyVoicePresence({ idleMs: 0, locked: false, supported: false }, 10)).toBe(
      "unknown",
    );
    expect(classifyVoicePresence({ idleMs: NaN, locked: false, supported: true }, 10)).toBe(
      "unknown",
    );
    expect(classifyVoicePresence({ idleMs: -1, locked: false, supported: true }, 10)).toBe(
      "unknown",
    );
  });
  it("sleeps at the configured threshold and keeps lock authoritative when idle sleep is disabled", () => {
    expect(classifyVoicePresence({ idleMs: 599_999, locked: false, supported: true }, 10)).toBe(
      "active",
    );
    expect(classifyVoicePresence({ idleMs: 600_000, locked: false, supported: true }, 10)).toBe(
      "idle",
    );
    expect(classifyVoicePresence({ idleMs: 600_000, locked: false, supported: true }, 0)).toBe(
      "active",
    );
    expect(classifyVoicePresence({ idleMs: 0, locked: true, supported: true }, 0)).toBe("away");
  });
});

describe("conversation capture presence", () => {
  it("keeps capture active with recent admitted speech despite input idle", () => {
    expect(deriveCapturePresence("idle", "active", 1_000, 10, 600_999)).toBe("active");
    expect(deriveCapturePresence("idle", "active", 1_000, 10, 601_000)).toBe("idle");
    expect(deriveCapturePresence("idle", "active", null, 10, 2_000)).toBe("idle");
    expect(deriveCapturePresence("idle", "active", 3_000, 10, 2_000)).toBe("idle");
  });
  it("never turns lock, unknown or manual absence into active presence", () => {
    expect(deriveCapturePresence("away", "active", 1_000, 10, 2_000)).toBe("away");
    expect(deriveCapturePresence("unknown", "active", 1_000, 10, 2_000)).toBe("unknown");
    expect(deriveCapturePresence("idle", "away", 1_000, 10, 2_000)).toBe("away");
    expect(deriveCapturePresence("active", "dnd", 1_000, 10, 2_000)).toBe("away");
  });
  it("does not extend an idle state when idle sleep is disabled or invalid", () => {
    expect(deriveCapturePresence("idle", "active", 1_000, 0, 2_000)).toBe("idle");
    expect(deriveCapturePresence("active", "active", 1_000, 0, 2_000)).toBe("active");
    expect(deriveCapturePresence("idle", "active", 1_000, NaN, 2_000)).toBe("idle");
  });
});
it("accepted speech postpones idle sleep and is reported to the Host; no speech reports nothing", () => {
  resetVoiceActivityForTest();
  expect(takeVoiceActivityReport()).toBeUndefined();
  const at = markAcceptedVoiceSpeech();
  expect(deriveCapturePresence("idle", "present", at, 10, at + 9 * 60_000)).toBe("active");
  expect(deriveCapturePresence("idle", "present", null, 10, at + 9 * 60_000)).toBe("idle");
  expect(takeVoiceActivityReport()).toBeGreaterThanOrEqual(0);
});
