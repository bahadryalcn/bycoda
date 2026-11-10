import { useEffect, useLayoutEffect, useRef } from "react";
import { listenVoiceTalk } from "../../../platform/tauri/voiceTalkEvent";

const CAN_TALK = new Set(["idle", "ready", "sleeping"]);
/** Window event from the opt-in wake listener after the owner spoke their wake phrase. */
export const VOICE_WAKE_EVENT = "bycoda:voice-wake";

/**
 * The OS-wide Talk shortcut and the owner's own wake phrase are explicit owner actions: each
 * starts Talk exactly like the button, and does nothing while voice is already connecting,
 * live or reconnecting (mute stays as is).
 */
export function useVoiceTalkEvent(options: { status: string; start: () => void }) {
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  useEffect(() => {
    const talk = () => {
      if (CAN_TALK.has(latest.current.status)) latest.current.start();
    };
    const subscription = listenVoiceTalk(talk);
    window.addEventListener(VOICE_WAKE_EVENT, talk);
    return () => {
      window.removeEventListener(VOICE_WAKE_EVENT, talk);
      return subscription();
    };
  }, []);
}
