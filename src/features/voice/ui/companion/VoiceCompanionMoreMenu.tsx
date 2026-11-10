import { useState } from "react";
import { Button } from "../../../../shared/ui/Button";
import { DropdownMenu, type DropdownMenuItem } from "../../../../shared/ui/DropdownMenu";
import { MoreHorizontal } from "../../../../shared/ui/icons";
import { t } from "../../../../shared/i18n";
import { voiceTurnActions } from "../VoiceTurnControl";

/**
 * The compact pill's overflow: turn ending, Finish and speaker mute. The microphone and the
 * disconnect stay visible on the pill itself.
 */
export function VoiceCompanionMoreMenu({
  live,
  manual,
  muted,
  speakerMuted,
  onManualChange,
  onFinish,
  onToggleSpeaker,
}: {
  live: boolean;
  manual: boolean;
  muted: boolean;
  speakerMuted: boolean;
  onManualChange: (manual: boolean) => void;
  onFinish: () => void;
  onToggleSpeaker: () => void;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const actions = voiceTurnActions(manual, onManualChange);
  const items: DropdownMenuItem[] = [
    ...actions.map((action) => ({
      kind: "item" as const,
      id: action.id,
      label: action.label,
      description: action.description,
      checked: action.checked,
      selectionRole: "radio" as const,
    })),
    { kind: "sep" },
    ...(live && manual
      ? [{ kind: "item" as const, id: "finish", label: t("Finish turn"), disabled: muted }]
      : []),
    {
      kind: "item",
      id: "speaker",
      label: t("Mute speaker"),
      checked: speakerMuted,
      selectionRole: "checkbox",
    },
  ];
  return (
    <>
      <Button
        iconOnly
        size="sm"
        variant="ghost"
        label={t("More voice options")}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
      >
        <MoreHorizontal className="icon-sm" />
      </Button>
      {anchor && (
        <DropdownMenu
          anchor={anchor}
          align="end"
          label={t("More voice options")}
          items={items}
          onClose={() => setAnchor(null)}
          onPick={(id) => {
            setAnchor(null);
            if (id === "finish") onFinish();
            else if (id === "speaker") onToggleSpeaker();
            else actions.find((action) => action.id === id)?.onSelect();
          }}
        />
      )}
    </>
  );
}
