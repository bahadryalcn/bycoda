import { useEffect, useLayoutEffect, useRef } from "react";
import { keybindingPressed } from "../../settings/model/settings";
import { useKeybindingShortcut } from "../../settings/model/useKeybindingShortcut";

export const VOICE_PUSH_TO_TALK = "Voice: Push to Talk";
/** App-focused, opt-in hold shortcut. Never opens a microphone from idle. */
export function useVoicePushToTalk(options: {
  enabled: boolean;
  begin: () => boolean;
  end: () => void;
  cancel: () => void;
}) {
  const binding = useKeybindingShortcut(VOICE_PUSH_TO_TALK);
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  useEffect(() => {
    if (!options.enabled || !binding) return;
    let held: string | undefined;
    const cancel = () => {
      if (held !== undefined) {
        held = undefined;
        latest.current.cancel();
      }
    };
    const down = (event: KeyboardEvent) => {
      if (held !== undefined && event.key === "Escape") {
        event.preventDefault();
        cancel();
        return;
      }
      if (held !== undefined || event.repeat || event.isComposing || event.defaultPrevented) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('input, textarea, [contenteditable="true"], [role="textbox"]')
      )
        return;
      if (!keybindingPressed(VOICE_PUSH_TO_TALK, event, false) || !latest.current.begin()) return;
      held = event.code || event.key;
      event.preventDefault();
    };
    const up = (event: KeyboardEvent) => {
      if (held === undefined || held !== (event.code || event.key)) return;
      held = undefined;
      event.preventDefault();
      latest.current.end();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", cancel);
      cancel();
    };
  }, [options.enabled, binding]);
  return binding;
}
