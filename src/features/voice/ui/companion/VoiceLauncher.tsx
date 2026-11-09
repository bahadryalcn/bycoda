import { useEffect, useLayoutEffect, useRef, type Ref } from "react";
import { IS_MAC } from "../../../../platform/tauri/platform";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { keybindingPressed } from "../../../settings/public/settings";
import { useKeybindingShortcut } from "../../../settings/public/useKeybindingShortcut";
import type { VoiceVisual } from "../../model/voiceSettings";
import { VoiceVisualizer } from "../VoiceVisualizer";
import styles from "../VoiceCompanion.module.css";

export const VOICE_OPEN_COMPANION = "Voice: Open Companion";

/** Default chord: Mod+Shift+K. Rebinding and disabling go through `keybindingPressed`. */
export function voiceOpenShortcutPressed(event: KeyboardEvent): boolean {
  if (event.isComposing || event.repeat || event.defaultPrevented) return false;
  const defaultMatch =
    (IS_MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) &&
    event.shiftKey &&
    !event.altKey &&
    event.key.toLowerCase() === "k";
  return keybindingPressed(VOICE_OPEN_COMPANION, event, defaultMatch);
}

/**
 * Closed voice companion: the owner's chosen visual and the assistant's name in a pill, so it
 * never reads as another chat or feedback icon. The open shortcut works from anywhere in the app.
 */
export function VoiceLauncher({
  ref,
  visual,
  name,
  onOpen,
}: {
  ref: Ref<HTMLButtonElement>;
  visual: VoiceVisual;
  name: string;
  onOpen: () => void;
}) {
  const shortcut = useKeybindingShortcut(VOICE_OPEN_COMPANION);
  const latest = useRef(onOpen);
  useLayoutEffect(() => {
    latest.current = onOpen;
  });
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (!voiceOpenShortcutPressed(event)) return;
      event.preventDefault();
      latest.current();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);
  const label = name ? t("Talk to {p0}", { p0: name }) : t("Voice companion");
  return (
    <div className={styles.launcher}>
      <Button
        ref={ref}
        shape="pill"
        className={styles.launcherButton}
        label={label}
        tooltip={name ? t("Voice assistant") : undefined}
        shortcut={shortcut}
        tooltipSide="top"
        startIcon={<VoiceVisualizer visual={visual} state="off" small="icon" />}
        onClick={onOpen}
      >
        {name || t("Voice")}
      </Button>
    </div>
  );
}
