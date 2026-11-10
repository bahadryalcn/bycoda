import { useEffect, useState } from "react";
import { withTimeout } from "../../../shared/lib/withTimeout";
import { elapsedSince, monotonicNow } from "../../../shared/lib/time/timestamps";
import { noteVoiceActivity } from "../../../shared/lib/voiceActivity";

export type VoicePresence = "active" | "idle" | "away" | "unknown";
export type UserPresence = { idleMs: number; locked: boolean; supported: boolean };

/** Speech can extend an already-authorized capture through mouse/keyboard idle,
 * but cannot establish computer presence or override a manual absence. Callers
 * must discard receipts when capture authority or its generation changes. */
export function deriveCapturePresence(
  rawPresence: VoicePresence,
  manualPresence: string | undefined,
  latestAdmittedSpeechAt: number | null,
  idleSleepMinutes: number,
  now = Date.now(),
): VoicePresence {
  if (manualPresence === "away" || manualPresence === "dnd") return "away";
  if (rawPresence !== "idle") return rawPresence;
  const age = latestAdmittedSpeechAt === null ? NaN : now - latestAdmittedSpeechAt;
  return Number.isFinite(idleSleepMinutes) &&
    idleSleepMinutes > 0 &&
    Number.isFinite(age) &&
    age >= 0 &&
    age < idleSleepMinutes * 60_000
    ? "active"
    : rawPresence;
}

/** Accepted owner speech: postpones idle sleep and tells the Host the owner is present. Returns its time. */
export function markAcceptedVoiceSpeech(): number {
  noteVoiceActivity();
  return Date.now();
}

export function classifyVoicePresence(value: UserPresence, minutes: number): VoicePresence {
  if (!value.supported || !Number.isFinite(value.idleMs) || value.idleMs < 0) return "unknown";
  if (value.locked) return "away";
  return minutes > 0 && value.idleMs >= minutes * 60_000 ? "idle" : "active";
}
/** Fresh native evidence only; page input cannot authorize an Away/DND override. */
export async function readNativeVoicePresence(minutes: number): Promise<VoicePresence> {
  if (!("__TAURI_INTERNALS__" in window)) return "unknown";
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return classifyVoicePresence(
      await withTimeout(invoke<UserPresence>("get_user_presence"), 3000, "Native presence"),
      minutes,
    );
  } catch {
    return "unknown";
  }
}

/** Native presence is computer-wide. Browser fallback observes only this page;
 * a hidden page cannot establish that the owner is away from the computer. */
export function useVoicePresence(enabled: boolean, minutes: number): VoicePresence {
  const [presence, setPresence] = useState<VoicePresence>("unknown");
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let lastInput = monotonicNow();
    const input = () => {
      lastInput = monotonicNow();
      if (!("__TAURI_INTERNALS__" in window)) setPresence("active");
    };
    const poll = async () => {
      let next: VoicePresence = "unknown";
      if ("__TAURI_INTERNALS__" in window) {
        try {
          next = await readNativeVoicePresence(minutes);
        } catch {
          /* Missing/failed native evidence is unknown, never active. */
        }
      } else if (document.visibilityState !== "hidden") {
        next = classifyVoicePresence(
          { idleMs: elapsedSince(lastInput), locked: false, supported: true },
          minutes,
        );
      }
      if (stopped) return;
      setPresence(next);
      timer = setTimeout(() => void poll(), 5000);
    };
    window.addEventListener("pointerdown", input, true);
    window.addEventListener("pointermove", input, true);
    window.addEventListener("keydown", input, true);
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("pointerdown", input, true);
      window.removeEventListener("pointermove", input, true);
      window.removeEventListener("keydown", input, true);
    };
  }, [enabled, minutes]);
  return presence;
}
