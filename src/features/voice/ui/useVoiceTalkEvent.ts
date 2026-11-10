import { useEffect, useLayoutEffect, useRef } from "react";
import { listenVoiceTalk } from "../../../platform/tauri/voiceTalkEvent";

const CAN_TALK = new Set(["idle", "ready", "sleeping"]);

/**
 * The OS-wide Talk shortcut is an explicit owner action: it starts Talk exactly like the button,
 * and does nothing while voice is already connecting, live or reconnecting (mute stays as is).
 */
export function useVoiceTalkEvent(options: { status: string; start: () => void }) {
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  useEffect(
    () =>
      listenVoiceTalk(() => {
        if (CAN_TALK.has(latest.current.status)) latest.current.start();
      }),
    [],
  );
}
