import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";
import { readDesktopPresence, type DesktopPresence } from "./desktop-presence";

/** Accepted owner speech this recent counts as input at this computer. */
export const VOICE_ACTIVITY_WINDOW_MS = 2 * 60_000;

/**
 * Keyboard and mouse idle misses an owner who is talking to the voice assistant.
 * The desktop reports the age of its last accepted speech; within the window it
 * lowers the idle time. A locked or unsupported reading is never changed, and the
 * owner's manual Away/DND is checked by the callers before any automatic reading.
 */
export class OwnerVoiceActivity {
  private at: number | undefined;
  constructor(private readonly now: () => number = monotonicNow) {}

  /** `ageMs`: time since the desktop accepted speech; anything outside the window is ignored. */
  record(ageMs: unknown): void {
    if (typeof ageMs !== "number" || !Number.isFinite(ageMs)) return;
    if (ageMs < 0 || ageMs >= VOICE_ACTIVITY_WINDOW_MS) return;
    const at = this.now() - ageMs;
    if (this.at === undefined || at > this.at) this.at = at;
  }

  apply(reading: DesktopPresence): DesktopPresence {
    if (this.at === undefined || !reading.supported || reading.locked) return reading;
    const age = elapsedSince(this.at, this.now());
    if (age >= VOICE_ACTIVITY_WINDOW_MS) return reading;
    if (reading.idleMs !== undefined && reading.idleMs <= age) return reading;
    return { ...reading, idleMs: age };
  }
}

export const ownerVoiceActivity = new OwnerVoiceActivity();

/** The desktop presence reading with accepted voice activity folded in. */
export async function readDesktopPresenceWithVoice(): Promise<DesktopPresence> {
  return ownerVoiceActivity.apply(await readDesktopPresence());
}
