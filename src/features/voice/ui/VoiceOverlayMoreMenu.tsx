import { Button } from "../../../shared/ui/Button";
import { popupNativeDropdownMenu } from "../../../shared/ui/DropdownMenu";
import { MoreHorizontal } from "../../../shared/ui/icons";
import { t } from "../../../shared/i18n";

/**
 * The compact overlay's overflow: Finish turn, expand and return to the app. The turn-ending
 * choice lives on the expanded dock. It opens a native menu because an in-page popover would be
 * clipped by the small window; the microphone, speaker mute and End stay visible on the pill.
 */
export function VoiceOverlayMoreMenu({
  live,
  manual,
  muted,
  disabled,
  onFinish,
  onExpand,
  onReturn,
  onError,
}: {
  live: boolean;
  manual: boolean;
  muted: boolean;
  disabled: boolean;
  onFinish: () => void;
  onExpand: () => void;
  onReturn: () => void;
  onError: (cause: unknown) => void;
}) {
  function show(anchor: HTMLButtonElement) {
    const items = [
      ...(live && manual ? [{ id: "finish", label: t("Finish turn"), disabled: muted }] : []),
      { id: "expand", label: t("Expand voice companion") },
      { id: "return", label: t("Return to app") },
    ];
    void popupNativeDropdownMenu(anchor, items, (id) => {
      if (id === "finish") onFinish();
      else if (id === "expand") onExpand();
      else if (id === "return") onReturn();
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
