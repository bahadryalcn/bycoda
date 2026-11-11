import { useEffect, useLayoutEffect, useRef, type ReactNode, type Ref } from "react";
import { IS_MAC } from "../../../../platform/tauri/platform";
import { t } from "../../../../shared/i18n";
import { AssistantAvatarMark } from "../../../assistant/public/avatar";
import { Button } from "../../../../shared/ui/Button";
import { AppWindow } from "../../../../shared/ui/icons";
import { Portal } from "../../../../shared/ui/Portal";
import { StatusDot } from "../../../../shared/ui/StatusDot";
import { keybindingPressed } from "../../../settings/public/settings";
import { useKeybindingShortcut } from "../../../settings/public/useKeybindingShortcut";
import type { VoiceVisual } from "../../model/voiceSettings";
import type { VoiceVisualState } from "../../model/voiceVisualState";
import { VoiceVisualizer } from "../VoiceVisualizer";
import styles from "../VoiceCompanion.module.css";
import { useVoiceLauncherSlot } from "./voiceLauncherSlot";

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
 * Where a closed companion's control sits: docked in the sidebar footer beside Settings when
 * that footer is visible, otherwise floating in the window corner.
 */
export function VoiceLauncherFrame({ children }: { children: ReactNode }) {
  const slot = useVoiceLauncherSlot();
  if (slot) return <Portal target={slot}>{children}</Portal>;
  return <div className={styles.launcher}>{children}</div>;
}

/** Shown while the companion floats in its own window: brings it back into this window. */
export function VoiceReturnButton({
  ref,
  onReturn,
}: {
  ref: Ref<HTMLButtonElement>;
  onReturn: () => void;
}) {
  return (
    <VoiceLauncherFrame>
      <Button
        ref={ref}
        iconOnly
        selected
        label={t("Return voice companion to this window")}
        onClick={onReturn}
      >
        <AppWindow className="icon-md" />
      </Button>
    </VoiceLauncherFrame>
  );
}

/** Corner dot on the avatar: none while voice is off, grey when muted, live states pulse green. */
export function voiceStatusTone(state: VoiceVisualState) {
  if (state === "off") return undefined;
  if (state === "muted") return "neutral";
  if (state === "connecting") return "warning";
  if (state === "error") return "danger";
  return "success";
}

/**
 * Closed voice companion: the assistant's avatar (its default portrait when none was chosen,
 * the name's initial when the image fails) and name in a pill, with a status dot on the avatar.
 * Before setup there is no assistant yet, so the voice visual stands in. The open shortcut works
 * from anywhere in the app.
 */
export function VoiceLauncher({
  ref,
  visual,
  name,
  avatar,
  state,
  onOpen,
}: {
  ref: Ref<HTMLButtonElement>;
  visual: VoiceVisual;
  name: string;
  avatar: string | undefined;
  state: VoiceVisualState;
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
  const slot = useVoiceLauncherSlot();
  const compact = slot?.hasAttribute("data-compact") === true;
  const label = name ? t("Talk to {p0}", { p0: name }) : t("Voice companion");
  const tone = voiceStatusTone(state);
  const icon = name ? (
    <span className={styles.launcherAvatar} data-state={state}>
      <AssistantAvatarMark className={styles.launcherMark} value={avatar} name={name} />
      {tone && (
        <StatusDot className={styles.launcherDot} tone={tone} size="fixed" appearance="solid" />
      )}
    </span>
  ) : (
    <VoiceVisualizer visual={visual} state="off" small="icon" />
  );
  return (
    <VoiceLauncherFrame>
      <Button
        ref={ref}
        shape="pill"
        iconOnly={compact}
        className={styles.launcherButton}
        data-docked={slot ? "" : undefined}
        label={label}
        tooltip={compact ? label : name ? t("Voice assistant") : undefined}
        shortcut={shortcut}
        tooltipSide={compact ? "right" : "top"}
        startIcon={compact ? undefined : icon}
        onClick={onOpen}
      >
        {compact ? icon : name || t("Voice")}
      </Button>
    </VoiceLauncherFrame>
  );
}
