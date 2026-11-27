import { useEffect, useState, useSyncExternalStore } from "react";
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

type PresenceListener = (presence: VoicePresence) => void;
type SharedPresencePoll = {
  listeners: Set<PresenceListener>;
  last?: VoicePresence;
  timer?: ReturnType<typeof setTimeout>;
  stop: () => void;
};

/** One poll per idle threshold. Wake listening and the companion join it, so
 * both being on still costs one native read every 5 s, not two. */
const sharedPolls = new Map<number, SharedPresencePoll>();

function startSharedPoll(minutes: number): SharedPresencePoll {
  let stopped = false;
  let lastInput = monotonicNow();
  const poll: SharedPresencePoll = {
    listeners: new Set(),
    stop: () => {
      stopped = true;
      clearTimeout(poll.timer);
      window.removeEventListener("pointerdown", input, true);
      window.removeEventListener("pointermove", input, true);
      window.removeEventListener("keydown", input, true);
    },
  };
  const publish = (next: VoicePresence) => {
    poll.last = next;
    for (const listener of poll.listeners) listener(next);
  };
  const input = () => {
    lastInput = monotonicNow();
    if (!("__TAURI_INTERNALS__" in window)) publish("active");
  };
  const tick = async () => {
    let next: VoicePresence = "unknown";
    if ("__TAURI_INTERNALS__" in window) {
      // Native evidence is computer-wide, so it is read even while this page is hidden:
      // background wake listening and its safety stop depend on it.
      next = await readNativeVoicePresence(minutes);
    } else if (document.visibilityState !== "hidden") {
      next = classifyVoicePresence(
        { idleMs: elapsedSince(lastInput), locked: false, supported: true },
        minutes,
      );
    }
    if (stopped) return;
    publish(next);
    poll.timer = setTimeout(() => void tick(), 5000);
  };
  window.addEventListener("pointerdown", input, true);
  window.addEventListener("pointermove", input, true);
  window.addEventListener("keydown", input, true);
  void tick();
  return poll;
}

/** Joins the shared poll for this threshold and gets its latest value at once. The
 * last consumer to leave stops the poll, so no native read runs without a consumer. */
export function subscribeVoicePresence(minutes: number, listener: PresenceListener): () => void {
  let poll = sharedPolls.get(minutes);
  if (!poll) {
    poll = startSharedPoll(minutes);
    sharedPolls.set(minutes, poll);
  }
  const shared = poll;
  shared.listeners.add(listener);
  if (shared.last !== undefined) listener(shared.last);
  return () => {
    shared.listeners.delete(listener);
    if (shared.listeners.size) return;
    shared.stop();
    if (sharedPolls.get(minutes) === shared) sharedPolls.delete(minutes);
  };
}

/** Whether this page is on screen. A hidden or minimized window has no visible
 * presence consumer, so a consumer that only needs presence for what is on screen can stop polling. */
function subscribeVisibility(listener: () => void) {
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
}
const pageShown = () => document.visibilityState !== "hidden";
export function useWindowShown(): boolean {
  return useSyncExternalStore(subscribeVisibility, pageShown, () => true);
}

/** Native presence is computer-wide. Browser fallback observes only this page;
 * a hidden page cannot establish that the owner is away from the computer.
 * Disabling the consumer makes the value "unknown", so nothing acts on a stale sample. */
export function useVoicePresence(enabled: boolean, minutes: number): VoicePresence {
  const [presence, setPresence] = useState<VoicePresence>("unknown");
  useEffect(() => {
    if (!enabled) return;
    // Reason: a re-enabled consumer must not act on its previous session's sample before the next one.
    setPresence("unknown");
    return subscribeVoicePresence(minutes, setPresence);
  }, [enabled, minutes]);
  return enabled ? presence : "unknown";
}
