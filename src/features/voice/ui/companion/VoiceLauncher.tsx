import { surfaceAttributes } from "../../../../shared/ui/Surface";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type Ref,
} from "react";
import { IS_MAC } from "../../../../platform/tauri/platform";
import { useStableCallback } from "../../../../shared/hooks/useStableCallback";
import { t } from "../../../../shared/i18n";
import { AssistantAvatarMark } from "../../../assistant/public/avatar";
import { Button } from "../../../../shared/ui/Button";
import { ButtonGroup } from "../../../../shared/ui/ButtonGroup";
import { AppWindow, ChevronDown, ChevronUp } from "../../../../shared/ui/icons";
import { InlineError } from "../../../../shared/ui/InlineError";
import { Popover } from "../../../../shared/ui/Popover";
import { Portal } from "../../../../shared/ui/Portal";
import { StatusDot } from "../../../../shared/ui/StatusDot";
import { Switch } from "../../../../shared/ui/Switch";
import { keybindingPressed } from "../../../settings/public/settings";
import { useKeybindingShortcut } from "../../../settings/public/useKeybindingShortcut";
import type { VoiceVisual } from "../../model/voiceSettings";
import { voiceSaveFailures } from "../../model/voiceSettingsSave";
import type { VoiceVisualState } from "../../model/voiceVisualState";
import { VoiceVisualizer } from "../VoiceVisualizer";
import type { useVoiceWake } from "../useVoiceWake";
import styles from "../VoiceCompanion.module.css";
import { useVoiceLauncherSlot } from "./voiceLauncherSlot";

export const VOICE_OPEN_COMPANION = "Voice: Open Companion";

export type VoiceWakeControls = ReturnType<typeof useVoiceWake> & { onSetup: () => void };

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

/** Corner dot on the avatar: none while voice is off, grey in standby, live states pulse green. */
export function voiceStatusTone(state: VoiceVisualState) {
  if (state === "off") return undefined;
  if (state === "muted") return "neutral";
  if (state === "connecting") return "warning";
  if (state === "error") return "danger";
  return "success";
}

/**
 * Closed voice companion: the assistant's avatar (its default portrait when none was chosen,
 * the name's initial when the image fails) and a status dot. Docked controls show the name
 * when the rail is expanded.
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
  returnToWindow = false,
  wakeControls,
}: {
  ref: Ref<HTMLButtonElement>;
  visual: VoiceVisual;
  name: string;
  avatar: string | undefined;
  state: VoiceVisualState;
  onOpen: () => void;
  returnToWindow?: boolean;
  wakeControls?: VoiceWakeControls;
}) {
  const shortcut = useKeybindingShortcut(VOICE_OPEN_COMPANION);
  const open = useStableCallback(onOpen);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (!voiceOpenShortcutPressed(event)) return;
      event.preventDefault();
      open();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [open]);
  const slot = useVoiceLauncherSlot();
  const compact = slot?.hasAttribute("data-compact") === true;
  const label = returnToWindow
    ? t("Return voice companion to this window")
    : name
      ? t("Talk to {p0}", { p0: name })
      : t("Voice companion");
  const tone = voiceStatusTone(state);
  const wake = wakeControls?.indicator;
  const icon = name ? (
    <span className={styles.launcherAvatar} data-state={state}>
      <AssistantAvatarMark
        avatarSize={slot ? "sm" : undefined}
        className={slot ? undefined : styles.launcherMark}
        value={avatar}
        name={name}
        size="micro"
        tone="secondary"
        weight="medium"
        leading="none"
      />
      {tone && (
        <StatusDot
          className={styles.launcherDot}
          tone={tone}
          size="fixed"
          appearance="solid"
          halo="floating"
        />
      )}
      {wake && (
        <StatusDot
          className={styles.launcherWakeDot}
          data-wake-status={wake.kind}
          tone={wake.kind === "listening" ? "success" : "warning"}
          appearance="solid"
          halo="floating"
        />
      )}
    </span>
  ) : (
    <VoiceVisualizer visual={visual} state="off" small="icon" />
  );
  const launchButton = (
    <Button
      ref={ref}
      shape={wakeControls ? undefined : "pill"}
      variant={slot || wakeControls ? "ghost" : "secondary"}
      iconOnly={compact}
      padding={wakeControls && !compact ? { end: slot ? "none" : "xxs" } : undefined}
      {...(slot || wakeControls
        ? { className: styles.launcherButton }
        : surfaceAttributes({ variant: "floating", frame: "pane" }, styles.launcherButton))}
      data-docked={slot ? "" : undefined}
      label={label}
      tooltip={compact || returnToWindow ? label : name ? t("Voice assistant") : undefined}
      shortcut={shortcut}
      tooltipSide={compact ? "right" : "top"}
      startIcon={compact ? undefined : icon}
      truncate={Boolean(slot)}
      onClick={onOpen}
    >
      {compact ? icon : name || t("Voice")}
    </Button>
  );
  return (
    <VoiceLauncherFrame>
      {wakeControls ? (
        <ButtonGroup
          aria-label={t("Voice companion")}
          surface={slot ? "transparent" : "default"}
          selection={slot ? "plate" : "segment"}
          className={slot ? styles.dockedLauncherGroup : undefined}
        >
          {launchButton}
          <VoiceWakeMenu controls={wakeControls} docked={Boolean(slot)} compact={compact} />
        </ButtonGroup>
      ) : (
        launchButton
      )}
    </VoiceLauncherFrame>
  );
}

function VoiceWakeMenu({
  controls,
  docked,
  compact,
}: {
  controls: VoiceWakeControls;
  docked: boolean;
  compact: boolean;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const id = useId();
  const label = t("Voice settings");
  const { indicator } = controls;
  const status = indicator ? wakeStatusText(indicator) : undefined;
  const failure = useSyncExternalStore(voiceSaveFailures.subscribe, voiceSaveFailures.get)[
    "voice-wake"
  ];
  return (
    <>
      <Button
        ref={anchor}
        iconOnly
        size="xs"
        stretch={!docked}
        className={docked ? styles.dockedWakeTrigger : undefined}
        variant="ghost"
        label={label}
        tooltipSide="top"
        aria-description={status}
        aria-haspopup="dialog"
        aria-controls={open ? id : undefined}
        expanded={open}
        opens="up"
        endIcon={compact ? open ? <ChevronUp /> : <ChevronDown /> : undefined}
        onClick={() => setOpen((current) => !current)}
      />
      {open && (
        <Popover
          id={id}
          anchor={anchor}
          side="top"
          align="end"
          kind="dialog"
          size="sm"
          aria-label={label}
          className={styles.wakeMenu}
          onDismiss={() => setOpen(false)}
        >
          <Switch
            label={t("Wake and sleep phrases")}
            labelPosition="start"
            checked={controls.enabled}
            onCheckedChange={controls.setEnabled}
            description={status}
          />
          {failure && (
            <InlineError action={{ label: t("Retry"), onClick: failure.retry }}>
              {t("This change could not be saved. The saved value is still in use.")}
            </InlineError>
          )}
          {indicator?.kind === "pack" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setOpen(false);
                controls.onSetup();
              }}
            >
              {t("Set up voice")}
            </Button>
          )}
        </Popover>
      )}
    </>
  );
}

function wakeStatusText(wake: NonNullable<VoiceWakeControls["indicator"]>) {
  switch (wake.kind) {
    case "listening":
      return t("Listening for “{p0}” only", { p0: wake.phrase });
    case "paused":
      return t("Paused: too much background speech");
    case "pack":
      return t("Wake phrase needs the local voice pack");
    case "error":
      return t("Wake phrase stopped listening. Check the microphone.");
  }
}
