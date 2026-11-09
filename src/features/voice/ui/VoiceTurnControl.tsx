import { useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { Check, ChevronDown, MoreHorizontal } from "../../../shared/ui/icons";
import { popupNativeActionMenu } from "../../../shared/ui/nativeActionMenu";
import { t } from "../../../shared/i18n";

export type VoiceTurnAction = {
  id: "manual" | "automatic";
  label: string;
  description: string;
  checked: boolean;
  onSelect: () => void;
};

/** The two turn-ending modes. Choosing one never commits audio; only Finish does. */
export function voiceTurnActions(
  manual: boolean,
  onManualChange: (manual: boolean) => void,
): VoiceTurnAction[] {
  return [
    {
      id: "manual",
      label: t("I'll finish when ready"),
      description: t("Press Finish turn to send your speech."),
      checked: manual,
      onSelect: () => onManualChange(true),
    },
    {
      id: "automatic",
      label: t("Reply when I pause"),
      description: t("Reply after a pause in your speech."),
      checked: !manual,
      onSelect: () => onManualChange(false),
    },
  ];
}

/**
 * Automatic shows the current mode in a labelled dropdown; in manual mode a separate Finish
 * button commits the turn. Compact (native overlay header) keeps a single icon menu.
 */
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
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const actions = voiceTurnActions(manual, onManualChange);
  const current = manual ? t("I'll finish when ready") : t("Reply when I pause");
  const finish = manual ? (
    <Button
      iconOnly
      variant="secondary"
      label={t("Finish turn")}
      tooltip={t("Finish turn")}
      disabled={muted}
      onClick={onFinish}
    >
      <Check className="icon-sm" />
    </Button>
  ) : null;
  const open = (button: HTMLButtonElement) => {
    if (menuSurface === "native")
      void popupNativeActionMenu(
        button,
        actions.map((action) => ({
          ...action,
          label: `${action.label} — ${action.description}`,
        })),
        (id) => actions.find((action) => action.id === id)?.onSelect(),
      ).catch(onMenuError ?? (() => undefined));
    else setAnchor(button);
  };
  const menu = anchor ? (
    <DropdownMenu
      anchor={anchor}
      label={t("Turn ending")}
      items={actions.map((action) => ({
        kind: "item" as const,
        id: action.id,
        label: action.label,
        description: action.description,
        checked: action.checked,
        selectionRole: "radio" as const,
      }))}
      onClose={() => setAnchor(null)}
      onPick={(id) => {
        actions.find((action) => action.id === id)?.onSelect();
        setAnchor(null);
      }}
    />
  ) : null;
  if (compact)
    return (
      <>
        {finish}
        <Button
          iconOnly
          label={t("Turn ending")}
          tooltip={t("Turn ending")}
          aria-haspopup="menu"
          aria-expanded={Boolean(anchor)}
          onClick={(event) => open(event.currentTarget)}
        >
          <MoreHorizontal className="icon-sm" />
        </Button>
        {menu}
      </>
    );
  return (
    <>
      {finish}
      <Button
        size="sm"
        variant="secondary"
        aria-label={current}
        aria-haspopup="menu"
        aria-expanded={menuSurface === "native" ? undefined : Boolean(anchor)}
        endIcon={<ChevronDown className="icon-xs" />}
        onClick={(event) => open(event.currentTarget)}
      >
        {current}
      </Button>
      {menu}
    </>
  );
}
