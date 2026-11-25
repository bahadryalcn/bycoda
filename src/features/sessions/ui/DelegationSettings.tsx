import { Badge } from "../../../shared/ui/Badge";
import { Text } from "../../../shared/ui/Text";
import { useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { SelectTrigger } from "../../../shared/ui/Select";
import { WandSparkles, X } from "../../../shared/ui/icons";
import {
  delegationNextValue,
  isDelegationSetting,
  isImageModelsSetting,
  isSubagentSetting,
  delegationOptionSelected,
  crossDelegationSummary,
  delegationShortLabel,
  type DelegationOption,
} from "../model/crossDelegation";
import { catalogText } from "../model/catalogText";
import type { ModelSetting } from "../model/models";
import type { HarnessId } from "../model/session";
import { HarnessIcon } from "./HarnessIcon";
import { ModelAccountNumber } from "./ModelAccountIdentity";
import { HARNESS_TITLE } from "../../../shared/model/harnessIdentity";
import type { DropdownMenuItem, DropdownMenuAction } from "../../../shared/ui/DropdownMenu";
import { decodeAdvisor } from "../../../shared/model/host-contracts/delegation";
import {
  IMAGE_MODEL_INFO,
  type ImageModelId,
} from "../../../shared/model/host-contracts/image-models";

const providerIcon = (harness: HarnessId | undefined) =>
  harness ? <HarnessIcon harness={harness} className="size-3.5 shrink-0" /> : undefined;

/**
 * Subagents (any provider): checkbox rows in a menu that stays open while
 * several models are toggled.
 */
export function DelegationSubagentsControl({
  label,
  setting,
  values,
  disabled,
  disabledReason,
  onChange,
  appearance = "ghost",
}: {
  label: string;
  setting: ModelSetting;
  values: Record<string, string>;
  disabled: boolean;
  /** Translated reason the control is disabled. */
  disabledReason?: string;
  onChange: (value: string) => void;
  /** `field` matches the bordered selects beside it on settings rows. */
  appearance?: "ghost" | "field";
}) {
  const t = useT();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const automatic = isSubagentSetting(setting) && (values[setting.id] ?? setting.value) === "auto";
  const summary = automatic ? (
    <Badge size="xs" tone="accent" icon={<WandSparkles className="icon-xs" />}>
      {t("Automatic")}
    </Badge>
  ) : (
    catalogText(t, crossDelegationSummary(setting, values))
  );
  const firstPicked = setting.options.find(
    (option) => option.value && delegationOptionSelected(setting, values, option.value),
  )?.value;
  return (
    <div className="flex min-w-0 flex-col items-end gap-1">
      {appearance === "field" ? (
        <SelectTrigger
          ref={anchor}
          type="button"
          aria-label={label}
          aria-haspopup="menu"
          expanded={open}
          data-state={open ? "open" : "closed"}
          data-disabled={disabled || undefined}
          disabled={disabled}
          onClick={() => setOpen((next) => !next)}
          className="bycoda-arc-select w-auto max-w-52"
        >
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            {firstPicked || setting.options.some((option) => option.value === "") ? (
              <span className="grid size-4 shrink-0 place-items-center">
                <DelegationOptionIcon setting={setting} value={firstPicked ?? ""} />
              </span>
            ) : null}
            <Text size="inherit" tone="inherit" truncate className="min-w-0">
              {summary}
            </Text>
          </span>
        </SelectTrigger>
      ) : (
        <Button
          ref={anchor}
          variant="ghost"
          type="button"
          aria-label={label}
          aria-haspopup="menu"
          expanded={open}
          disabled={disabled}
          disabledReason={disabledReason}
          onClick={() => setOpen((next) => !next)}
          className="w-[52%] max-w-46 min-w-0 shrink-0"
        >
          <Text size="inherit" tone="inherit" truncate className="min-w-0">
            {summary}
          </Text>
        </Button>
      )}
      {open ? (
        <DropdownMenu
          anchor={anchor}
          label={label}
          items={delegationMenuItems(setting, values, t)}
          onPick={(id) => onChange(delegationNextValue(setting, values, id))}
          onClose={() => setOpen(false)}
          returnFocusRef={anchor}
          side="bottom"
          align="end"
          width="content"
          maxHeight={360}
        />
      ) : null}
    </div>
  );
}

/** The provider icon of one any-provider delegation option; nothing for Off. */
export function DelegationOptionIcon({
  setting,
  value,
  showAccountNumber = true,
}: {
  setting: ModelSetting;
  value: string;
  /** Fixed-size picker icon slots only hold the provider glyph. */
  showAccountNumber?: boolean;
}) {
  if (value === "auto") return <WandSparkles className="icon-sm shrink-0" />;
  if (value === "" && setting.options.find((option) => option.value === "")?.label === "Off")
    return <X className="icon-sm shrink-0" />;
  if (value === "" && setting.options.find((option) => option.value === "")?.label !== "Off")
    return <WandSparkles className="icon-sm shrink-0" />;
  if (isImageModelsSetting(setting)) {
    const harness = IMAGE_MODEL_INFO[value as ImageModelId]?.harness;
    return harness ? providerIcon(harness) : null;
  }
  const ref = isDelegationSetting(setting) ? decodeAdvisor(value) : undefined;
  const option: DelegationOption | undefined = setting.options.find((item) => item.value === value);
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {providerIcon(ref?.harness)}
      {showAccountNumber ? <ModelAccountNumber account={option} /> : null}
    </span>
  );
}

/** Any-provider model lists need room for "Provider · Model" labels. */
export function settingMenuWidth(setting: ModelSetting, base: number): number {
  return isDelegationSetting(setting) ? Math.max(base, 320) : base;
}

/** Shared single-line delegation rows; source label remains accessible. */
function delegationMenuItems(
  setting: ModelSetting,
  values: Record<string, string>,
  t: (text: string) => string,
): DropdownMenuItem[] {
  const groups = new Map<string, DropdownMenuAction[]>();
  const leading: DropdownMenuAction[] = [];
  const options: DelegationOption[] = setting.options;
  for (const option of options) {
    const ref = isDelegationSetting(setting) ? decodeAdvisor(option.value) : undefined;
    const provider = ref ? HARNESS_TITLE[ref.harness] : "";
    const parts = option.label.split(" · ");
    const subagent = isSubagentSetting(setting);
    const primary = subagent
      ? (option.modelLabel ?? t(option.label))
      : provider && parts.length > 1
        ? parts[1]
        : t(option.label);
    const secondary = subagent
      ? option.accountLabel
      : provider
        ? [provider, ...parts.slice(2)].join(" · ")
        : "";
    const item: DropdownMenuAction = {
      kind: "item",
      id: option.value,
      label: t(option.label),
      title: subagent
        ? delegationShortLabel(setting, option.value, t(option.label))
        : t(option.label),
      checked: delegationOptionSelected(setting, values, option.value),
      selectionRole: "checkbox",
      icon: (
        <DelegationOptionIcon setting={setting} value={option.value} showAccountNumber={false} />
      ),
      content: (
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <Text size="inherit" tone="inherit" truncate>
            {primary}
          </Text>
          <ModelAccountNumber account={option} />
          {secondary ? (
            <Text size="caption" tone="muted" truncate>
              {secondary}
            </Text>
          ) : null}
        </span>
      ),
    };
    if (!provider) leading.push(item);
    else groups.set(provider, [...(groups.get(provider) ?? []), item]);
  }
  return [
    ...leading,
    ...Array.from(groups, ([provider, items]) =>
      groups.size > 1 ? [{ kind: "group" as const, id: provider, label: provider, items }] : items,
    ).flat(),
  ];
}

/** Model as primary text, provider/account as quiet same-line metadata. */
export function delegationSelectChoice(
  setting: ModelSetting,
  option: ModelSetting["options"][number],
  t: (text: string) => string,
) {
  const ref = isDelegationSetting(setting) ? decodeAdvisor(option.value) : undefined;
  const group =
    ref &&
    new Set(setting.options.map((item) => decodeAdvisor(item.value)?.harness).filter(Boolean))
      .size > 1
      ? HARNESS_TITLE[ref.harness]
      : undefined;
  if (isSubagentSetting(setting)) {
    return {
      label: delegationShortLabel(setting, option.value, t(option.label)),
      group,
    };
  }
  const parts = option.label.split(" · ");
  const model = ref && parts.length > 1 ? parts[1] : undefined;
  // The same model offered by several accounts needs the account in its name, or a summary of
  // the selection ("Haiku 5.5, Fable 5.2, Haiku 5.5") cannot tell the copies apart.
  const shared =
    ref &&
    model &&
    parts.length > 2 &&
    setting.options.filter((item) => item.label.split(" · ")[1] === model).length > 1;
  return {
    label: model ? (shared ? [model, ...parts.slice(2)].join(" · ") : model) : t(option.label),
    meta: ref
      ? [HARNESS_TITLE[ref.harness], ...(shared ? [] : parts.slice(2))].join(" · ")
      : undefined,
    group,
  };
}
