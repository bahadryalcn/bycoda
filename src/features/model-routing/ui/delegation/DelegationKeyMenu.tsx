import { useRef, useState } from "react";
import { useT } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { DropdownMenu } from "../../../../shared/ui/DropdownMenu";
import { Plus } from "../../../../shared/ui/icons";

export type DelegationKeyChoice = { key: string; label: string; value: string };

/** "Add setting" menu of an override: the delegation keys it does not set yet. */
export function DelegationKeyMenu({
  choices,
  disabled,
  onPick,
}: {
  choices: readonly DelegationKeyChoice[];
  disabled: boolean;
  onPick: (choice: DelegationKeyChoice) => void;
}) {
  const t = useT();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        ref={anchor}
        variant="ghost"
        size="sm"
        type="button"
        startIcon={<Plus />}
        disabled={disabled}
        disabledReason={t("Wait for the current save to finish.")}
        aria-haspopup="menu"
        expanded={open}
        onClick={() => setOpen((next) => !next)}
      >
        {t("Add setting")}
      </Button>
      {open ? (
        <DropdownMenu
          anchor={anchor}
          label={t("Add setting")}
          items={choices.map((choice) => ({
            kind: "item" as const,
            id: choice.key,
            label: choice.label,
          }))}
          onPick={(id) => {
            const choice = choices.find((item) => item.key === id);
            if (choice) onPick(choice);
          }}
          onClose={() => setOpen(false)}
          returnFocusRef={anchor}
          side="bottom"
          align="start"
          width="content"
        />
      ) : null}
    </>
  );
}
