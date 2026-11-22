import { Button } from "../../../shared/ui/Button";
import { popupNativeDropdownMenu } from "../../../shared/ui/DropdownMenu";
import { MoreHorizontal } from "../../../shared/ui/icons";
import { t } from "../../../shared/i18n";
import { voiceTurnActions } from "./VoiceTurnControl";

/**
 * The compact overlay's overflow: turn ending, Finish turn, speaker mute, expand and return to
 * the app. It opens a native menu because an in-page popover would be clipped by the small
 * window; the microphone and End stay visible on the pill.
 */
export function VoiceOverlayMoreMenu({
  live,
  manual,
  muted,
  speakerMuted,
  disabled,
  onManualChange,
  onFinish,
  onToggleSpeaker,
  onExpand,
  onReturn,
  onError,
}: {
  live: boolean;
  manual: boolean;
  muted: boolean;
  speakerMuted: boolean;
  disabled: boolean;
  onManualChange: (manual: boolean) => void;
  onFinish: () => void;
  onToggleSpeaker: () => void;
  onExpand: () => void;
  onReturn: () => void;
  onError: (cause: unknown) => void;
}) {
  function show(anchor: HTMLButtonElement) {
    const turns = voiceTurnActions(manual, onManualChange);
    const items = [
      ...(live ? turns : []),
      ...(live && manual ? [{ id: "finish", label: t("Finish turn"), disabled: muted }] : []),
      { id: "speaker", label: t("Mute speaker"), checked: speakerMuted },
      { id: "expand", label: t("Expand voice companion") },
      { id: "return", label: t("Return to app") },
    ];
    void popupNativeDropdownMenu(anchor, items, (id) => {
      if (id === "finish") onFinish();
      else if (id === "speaker") onToggleSpeaker();
      else if (id === "expand") onExpand();
      else if (id === "return") onReturn();
      else turns.find((turn) => turn.id === id)?.onSelect();
    }).catch(onError);
  }
  return (
    <Button
      iconOnly
      label={t("More voice options")}
      aria-haspopup="menu"
      disabled={disabled}
      disabledReason={t("Connecting…")}
      onClick={(event) => show(event.currentTarget)}
    >
      <MoreHorizontal className="icon-sm" />
    </Button>
  );
}
