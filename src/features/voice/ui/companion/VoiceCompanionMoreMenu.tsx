import { useState } from "react";
import { Button } from "../../../../shared/ui/Button";
import { DropdownMenu, type DropdownMenuItem } from "../../../../shared/ui/DropdownMenu";
import { MoreHorizontal } from "../../../../shared/ui/icons";
import { t } from "../../../../shared/i18n";
import { openSettingsSection } from "../../../settings/public/settingsLink";
import { pickVoiceDevice, useVoiceDeviceMenuItems } from "./voiceDeviceMenus";

/**
 * The companion's one overflow menu. Compact: Finish turn and speaker mute, which the pill has
 * no room for (the microphone and the disconnect stay on the pill; the turn-ending choice lives on
 * the expanded dock). Both sizes: microphone and audio output devices, Float outside the app and
 * the link to Voice settings, where provider, reply voice and speaker are chosen.
 */
export function VoiceCompanionMoreMenu({
  compact,
  live,
  manual,
  muted,
  speakerMuted,
  onFinish,
  onToggleSpeaker,
  onFloat,
}: {
  compact: boolean;
  live: boolean;
  manual: boolean;
  muted: boolean;
  speakerMuted: boolean;
  onFinish: () => void;
  onToggleSpeaker: () => void;
  /** Present only when the panel can float outside the app. */
  onFloat?: () => void;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const deviceItems = useVoiceDeviceMenuItems();
  const pillItems: DropdownMenuItem[] = compact
    ? [
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
      ]
    : [];
  const items: DropdownMenuItem[] = [
    ...pillItems,
    ...(pillItems.length ? [{ kind: "sep" as const }] : []),
    ...deviceItems,
    { kind: "sep" },
    ...(onFloat ? [{ kind: "item" as const, id: "float", label: t("Float outside the app") }] : []),
    { kind: "item", id: "settings", label: t("Voice settings") },
  ];
  return (
    <>
      <Button
        touchTarget="control"
        iconOnly
        size={compact ? "sm" : undefined}
        variant={compact ? "ghost" : undefined}
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
            if (pickVoiceDevice(id)) return;
            if (id === "finish") onFinish();
            else if (id === "speaker") onToggleSpeaker();
            else if (id === "float") onFloat?.();
            else if (id === "settings") openSettingsSection("voice");
          }}
        />
      )}
    </>
  );
}
