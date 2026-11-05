import { useState } from "react";
import { SplitButton } from "../../../shared/ui/SplitButton";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { Check, MoreHorizontal } from "../../../shared/ui/icons";
import { popupNativeActionMenu } from "../../../shared/ui/nativeActionMenu";
import { t } from "../../../shared/i18n";

/** Automatic shows the current mode; only explicit Finish commits manual audio. */
export function VoiceTurnControl({
  manual,
  muted,
  compact,
  menuSurface,
  onMenuError,
  onManualChange,
  onFinish,
}: {
  manual: boolean;
  muted: boolean;
  compact?: boolean;
  menuSurface?: "popover" | "native";
  onMenuError?: (cause: unknown) => void;
  onManualChange: (manual: boolean) => void;
  onFinish: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const actions = [
    {
      id: "manual",
      label: t("I'll finish when ready"),
      description: t("Press Finish turn to send your speech."),
      checked: manual,
      selectionRole: "radio" as const,
      onSelect: () => onManualChange(true),
    },
    {
      id: "automatic",
      label: t("Reply when I pause"),
      description: t("Reply after a pause in your speech."),
      checked: !manual,
      selectionRole: "radio" as const,
      onSelect: () => onManualChange(false),
    },
  ];
  if (compact)
    return (
      <>
        {manual && (
          <Button
            iconOnly
            label={t("Finish turn")}
            tooltip={t("Finish turn")}
            disabled={muted}
            onClick={onFinish}
          >
            <Check className="icon-sm" />
          </Button>
        )}
        <Button
          iconOnly
          label={t("Turn ending")}
          tooltip={t("Turn ending")}
          aria-haspopup="menu"
          aria-expanded={Boolean(anchor)}
          onClick={(event) => {
            if (menuSurface === "native") {
              void popupNativeActionMenu(
                event.currentTarget,
                actions.map((action) => ({
                  ...action,
                  label: `${action.label} — ${action.description}`,
                })),
                (id) => actions.find((action) => action.id === id)?.onSelect(),
              ).catch(onMenuError ?? (() => undefined));
            } else setAnchor(event.currentTarget);
          }}
        >
          <MoreHorizontal className="icon-sm" />
        </Button>
        {anchor && (
          <DropdownMenu
            anchor={anchor}
            label={t("Turn ending")}
            items={actions.map((action) => ({ ...action, kind: "item" as const }))}
            onClose={() => setAnchor(null)}
            onPick={(id) => {
              actions.find((action) => action.id === id)?.onSelect();
              setAnchor(null);
            }}
          />
        )}
      </>
    );
  return (
    <SplitButton
      label={manual ? t("Finish turn") : t("Reply when I pause")}
      aria-label={manual ? t("Finish turn") : t("Reply when I pause")}
      menuLabel={t("Turn ending")}
      menuSurface={menuSurface}
      onMenuError={onMenuError}
      menuOpen={menuOpen}
      onMenuOpenChange={setMenuOpen}
      aria-haspopup={manual ? undefined : "menu"}
      aria-expanded={manual || menuSurface === "native" ? undefined : menuOpen}
      tooltip={manual ? t("Finish turn") : t("Reply when I pause")}
      tooltipWhen="overflow"
      disabled={manual && muted}
      menuDisabled={false}
      onClick={() => (manual ? onFinish() : setMenuOpen(true))}
      actions={
        menuSurface === "native"
          ? actions.map((action) => ({
              ...action,
              label: `${action.label} — ${action.description}`,
            }))
          : actions
      }
    />
  );
}
