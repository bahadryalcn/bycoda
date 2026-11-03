import { useState } from "react";
import { SplitButton } from "../../../shared/ui/SplitButton";
import { t } from "../../../shared/i18n";

/** Automatic shows the current mode; only explicit Finish commits manual audio. */
export function VoiceTurnControl({ manual, muted, compact, menuSurface, onMenuError, onManualChange, onFinish }: {
  manual: boolean;
  muted: boolean;
  compact?: boolean;
  menuSurface?: "popover" | "native";
  onMenuError?: (cause: unknown) => void;
  onManualChange: (manual: boolean) => void;
  onFinish: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return <SplitButton
    label={manual ? compact ? t("Finish") : t("Finish turn") : compact ? t("Automatic") : t("Automatic replies")}
    aria-label={manual ? t("Finish turn") : t("Automatic replies")}
    menuLabel={t("Turn ending")}
    menuSurface={menuSurface}
    onMenuError={onMenuError}
    menuOpen={menuOpen}
    onMenuOpenChange={setMenuOpen}
    aria-haspopup={manual ? undefined : "menu"}
    aria-expanded={manual || menuSurface === "native" ? undefined : menuOpen}
    tooltip={manual ? t("Finish turn") : t("Automatic replies")}
    tooltipWhen="overflow"
    disabled={manual && muted}
    menuDisabled={false}
    onClick={() => manual ? onFinish() : setMenuOpen(true)}
    actions={[
      { id: "manual", label: t("Wait until I finish"), checked: manual, selectionRole: "radio", onSelect: () => onManualChange(true) },
      { id: "automatic", label: t("Automatic replies"), checked: !manual, selectionRole: "radio", onSelect: () => onManualChange(false) },
    ]}
  />;
}
