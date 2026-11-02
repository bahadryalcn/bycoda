import { useEffect, useState } from "react";

export type VoicePresence = "active" | "idle" | "away" | "unknown";
export type UserPresence = { idleMs: number; locked: boolean; supported: boolean };

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
    return classifyVoicePresence(await invoke<UserPresence>("get_user_presence"), minutes);
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
    let lastInput = Date.now();
    const input = () => {
      lastInput = Date.now();
      if (!("__TAURI_INTERNALS__" in window)) setPresence("active");
    };
    const poll = async () => {
      let next: VoicePresence = "unknown";
      if ("__TAURI_INTERNALS__" in window) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          next = classifyVoicePresence(await invoke<UserPresence>("get_user_presence"), minutes);
        } catch {
          /* Missing/failed native evidence is unknown, never active. */
        }
      } else if (document.visibilityState !== "hidden") {
        next = classifyVoicePresence(
          { idleMs: Date.now() - lastInput, locked: false, supported: true },
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
