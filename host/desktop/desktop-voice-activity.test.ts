import { describe, expect, it } from "vitest";
import { assistantPresenceState } from "../assistant/core/assistant-presence";
import {
  DEVICE_ACTIVITY_WINDOW_MS,
  OwnerDeviceActivity,
  OwnerVoiceActivity,
  VOICE_ACTIVITY_WINDOW_MS,
} from "./desktop-voice-activity";

describe("owner voice activity", () => {
  const away = { supported: true, locked: false, idleMs: 20 * 60_000 };
  it("treats recent accepted speech as input activity", () => {
    let now = 1_000_000;
    const voice = new OwnerVoiceActivity(() => now);
    voice.record(5_000);
    now += 10_000;
    expect(voice.apply(away)).toEqual({ supported: true, locked: false, idleMs: 15_000 });
  });
  it("ignores stale or invalid reports", () => {
    let now = 1_000_000;
    const voice = new OwnerVoiceActivity(() => now);
    voice.record(-1);
    voice.record(Number.NaN);
    voice.record(VOICE_ACTIVITY_WINDOW_MS + 1);
    expect(voice.apply(away)).toBe(away);
    voice.record(0);
    now += VOICE_ACTIVITY_WINDOW_MS;
    expect(voice.apply(away)).toBe(away);
  });
  it("never overrides a locked or unsupported reading", () => {
    const voice = new OwnerVoiceActivity(() => 1);
    voice.record(0);
    const locked = { supported: true, locked: true, idleMs: 9 };
    const unsupported = { supported: false, locked: false };
    expect(voice.apply(locked)).toBe(locked);
    expect(voice.apply(unsupported)).toBe(unsupported);
  });
  it("keeps the smaller idle time and fills a missing one", () => {
    const voice = new OwnerVoiceActivity(() => 100_000);
    voice.record(30_000);
    expect(voice.apply({ supported: true, locked: false, idleMs: 1_000 }).idleMs).toBe(1_000);
    expect(voice.apply({ supported: true, locked: false }).idleMs).toBe(30_000);
  });
  it("turns assistant presence from away to present only while speech is fresh, and locked wins", () => {
    let now = 1_000_000;
    const voice = new OwnerVoiceActivity(() => now);
    const policy = { idleMinutes: 5, awayMinutes: 10 };
    expect(assistantPresenceState(voice.apply(away), policy).state).toBe("away");
    voice.record(1_000);
    expect(assistantPresenceState(voice.apply(away), policy).state).toBe("present");
    expect(assistantPresenceState(voice.apply({ ...away, locked: true }), policy).state).toBe(
      "locked",
    );
    now += VOICE_ACTIVITY_WINDOW_MS;
    expect(assistantPresenceState(voice.apply(away), policy).state).toBe("away");
  });
});

describe("owner activity on another device", () => {
  const policy = { idleMinutes: 10, awayMinutes: 15 };
  it("keeps the owner available while another device reports use, then lapses", () => {
    let now = 1_000_000;
    const device = new OwnerDeviceActivity(() => now);
    const idle = { supported: true, locked: false, idleMs: 30 * 60_000 };
    const locked = { supported: true, locked: true, idleMs: 30 * 60_000 };
    const unsupported = { supported: false, locked: true };
    expect(device.apply(idle)).toBe(idle);
    device.record();
    now += 5_000;
    for (const reading of [idle, locked, unsupported])
      expect(assistantPresenceState(device.apply(reading), policy).state).toBe("present");
    const fresher = { supported: true, locked: false, idleMs: 1_000 };
    expect(device.apply(fresher)).toBe(fresher);
    now += DEVICE_ACTIVITY_WINDOW_MS;
    expect(device.apply(locked)).toBe(locked);
  });
});
