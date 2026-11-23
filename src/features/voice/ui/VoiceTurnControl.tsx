import { useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu, popupNativeDropdownMenu } from "../../../shared/ui/DropdownMenu";
import { Check } from "../../../shared/ui/icons";
import { t } from "../../../shared/i18n";

type VoiceTurnAction = {
  id: "manual" | "automatic";
  label: string;
  checked: boolean;
  onSelect: () => void;
};

/** The two turn-ending modes. Choosing one never commits audio; only Finish does. */
function voiceTurnActions(
  manual: boolean,
  onManualChange: (manual: boolean) => void,
): VoiceTurnAction[] {
  return [
    {
      id: "manual",
      label: t("I'll finish when ready"),
      checked: manual,
      onSelect: () => onManualChange(true),
    },
    {
      id: "automatic",
      label: t("Reply when I pause"),
      checked: !manual,
      onSelect: () => onManualChange(false),
    },
  ];
}

/**
 * The one turn-ending control of a live dock: a labelled dropdown showing the current mode; in
 * manual mode a separate Finish button commits the turn. The overlay opens a native menu because
 * an in-page popover would be clipped by its small window.
 */
export function VoiceTurnControl({
  manual,
  muted,
  menuSurface,
  onMenuError,
  onManualChange,
  onFinish,
}: {
  manual: boolean;
  muted: boolean;
  menuSurface?: "popover" | "native";
  onMenuError?: (cause: unknown) => void;
  onManualChange: (manual: boolean) => void;
  onFinish: () => void;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const actions = voiceTurnActions(manual, onManualChange);
  const current = manual ? t("I'll finish when ready") : t("Reply when I pause");
  const open = (button: HTMLButtonElement) => {
    if (menuSurface === "native")
      void popupNativeDropdownMenu(button, actions, (id) =>
        actions.find((action) => action.id === id)?.onSelect(),
      ).catch(onMenuError ?? (() => undefined));
    else setAnchor(button);
  };
  return (
    <>
      {manual ? (
        <Button
          iconOnly
          variant="secondary"
          label={t("Finish turn")}
          disabled={muted}
          onClick={onFinish}
        >
          <Check className="icon-sm" />
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="secondary"
        aria-label={current}
        aria-haspopup="menu"
        expanded={Boolean(anchor)}
        aria-expanded={menuSurface === "native" ? undefined : Boolean(anchor)}
        onClick={(event) => open(event.currentTarget)}
      >
        {current}
      </Button>
      {anchor ? (
        <DropdownMenu
          anchor={anchor}
          label={t("Turn ending")}
          items={actions.map((action) => ({
            kind: "item" as const,
            id: action.id,
            label: action.label,
            checked: action.checked,
            selectionRole: "radio" as const,
          }))}
          onClose={() => setAnchor(null)}
          onPick={(id) => {
            actions.find((action) => action.id === id)?.onSelect();
            setAnchor(null);
          }}
        />
      ) : null}
    </>
  );
}
