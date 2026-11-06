import { useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { ChevronDown } from "../../../shared/ui/icons";
import {
  delegationNextValue,
  delegationOptionHarness,
  isDelegationSetting,
  delegationOptionSelected,
  crossDelegationSummary,
} from "../model/crossDelegation";
import type { ModelSetting } from "../model/models";
import type { HarnessId } from "../model/session";
import { HarnessIcon } from "./HarnessIcon";

const providerIcon = (harness: HarnessId | undefined) =>
  harness ? <HarnessIcon harness={harness} className="size-3.5 shrink-0" /> : undefined;

/**
 * Subagents (any provider) in the Extras panel: checkbox rows in a menu. The menu
 * closes after each pick; keeping it open needs a DropdownMenu option.
 */
export function DelegationSubagentsControl({
  label,
  setting,
  values,
  disabled,
  onChange,
}: {
  label: string;
  setting: ModelSetting;
  values: Record<string, string>;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        ref={anchor}
        variant="ghost"
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((next) => !next)}
        className="w-[52%] max-w-[11.5rem] min-w-0 shrink-0"
      >
        <span className="min-w-0 truncate">{t(crossDelegationSummary(setting, values))}</span>
        <ChevronDown className="icon-xs shrink-0" />
      </Button>
      {open ? (
        <DropdownMenu
          anchor={anchor}
          label={label}
          items={setting.options.map((option) => ({
            kind: "item" as const,
            id: option.value,
            label: t(option.label),
            checked: delegationOptionSelected(setting, values, option.value),
            icon: providerIcon(delegationOptionHarness(setting, option.value)),
            selectionRole: "checkbox" as const,
          }))}
          onPick={(id) => onChange(delegationNextValue(setting, values, id))}
          onClose={() => setOpen(false)}
          returnFocusRef={anchor}
          side="bottom"
          align="end"
          width={228}
        />
      ) : null}
    </>
  );
}

/** The provider icon of one any-provider delegation option; nothing for Off. */
export function DelegationOptionIcon({ setting, value }: { setting: ModelSetting; value: string }) {
  return providerIcon(delegationOptionHarness(setting, value)) ?? null;
}

/** Any-provider model lists need room for "Provider · Model" labels. */
export function settingMenuWidth(setting: ModelSetting, base: number): number {
  return isDelegationSetting(setting) ? Math.max(base, 320) : base;
}
