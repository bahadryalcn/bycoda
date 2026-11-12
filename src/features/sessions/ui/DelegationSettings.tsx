import { Badge } from "../../../shared/ui/Badge";
import { AutomaticSubagentModels } from "./AutomaticSubagentModels";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { SelectTrigger } from "../../../shared/ui/Select";
import { ChevronDown, WandSparkles, X } from "../../../shared/ui/icons";
import {
  delegationNextValue,
  isDelegationSetting,
  isImageModelsSetting,
  isSubagentSetting,
  delegationOptionSelected,
  crossDelegationSummary,
  delegationShortLabel,
} from "../model/crossDelegation";
import type { ModelSetting } from "../model/models";
import type { HarnessId } from "../model/session";
import { HarnessIcon } from "./HarnessIcon";
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
  onChange,
  appearance = "ghost",
}: {
  label: string;
  setting: ModelSetting;
  values: Record<string, string>;
  disabled: boolean;
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
    t(crossDelegationSummary(setting, values))
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
          aria-expanded={open}
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
          <ChevronDown
            className={`bycoda-arc-select-chevron icon-sm shrink-0 ${open ? "rotate-180" : ""}`}
            strokeWidth={1.75}
          />
        </SelectTrigger>
      ) : (
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
          <Text size="inherit" tone="inherit" truncate className="min-w-0">
            {summary}
          </Text>
          <ChevronDown className="icon-xs shrink-0" />
        </Button>
      )}
      {automatic ? <AutomaticSubagentModels setting={setting} /> : null}
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

/**
 * A single any-provider choice (Advisor) as a full-width field: the setting's name sits inside
 * the field's top edge, the picked model under it without the provider the icon already shows.
 */
export function DelegationField({
  setting,
  label,
  picked,
  emptyLabel,
  disabled,
  describedBy,
  onClick,
}: {
  setting: ModelSetting;
  label: string;
  picked: { value: string; label: string } | undefined;
  emptyLabel: string;
  disabled: boolean;
  describedBy?: string;
  /** Opens the column-wide picker, which keeps the full "Provider · Model" labels. */
  onClick: () => void;
}) {
  const t = useT();
  return (
    <Button
      size="sm"
      variant="secondary"
      type="button"
      fullWidth
      align="start"
      // The direct layout lets the label fill the field so the chevron sits at its far edge.
      motion="none"
      className="h-auto py-1.5"
      disabled={disabled}
      aria-describedby={describedBy}
      aria-haspopup="dialog"
      data-model-setting-field
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      <span className="flex min-w-0 flex-1 flex-col items-start">
        <Text size="micro" data-setting-label>
          {label}
        </Text>
        <Text
          as="span"
          size="inherit"
          tone="inherit"
          leading="snug"
          className="flex max-w-full min-w-0 items-center gap-1.5"
        >
          {picked ? <DelegationOptionIcon setting={setting} value={picked.value} /> : null}
          <Text size="inherit" tone="inherit" truncate className="min-w-0">
            {picked ? delegationShortLabel(setting, picked.value, t(picked.label)) : emptyLabel}
          </Text>
        </Text>
      </span>
      <ChevronDown className="icon-xs shrink-0" tone="secondary" strokeWidth={1.75} />
    </Button>
  );
}

/** The provider icon of one any-provider delegation option; nothing for Off. */
export function DelegationOptionIcon({ setting, value }: { setting: ModelSetting; value: string }) {
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
  const color = (
    setting.options.find((option) => option.value === value) as
      | { accountColor?: string }
      | undefined
  )?.accountColor;
  const dot = color ? (
    <span
      {...surfaceAttributes({ radius: "pill" }, "size-2 shrink-0 ")}
      style={{ background: color }}
      aria-hidden
    />
  ) : null;
  if (!ref?.harness) return dot;
  // The account dot sits on the icon's corner so both fit one icon slot (select triggers are 16px).
  return (
    <span className="relative inline-flex shrink-0">
      {providerIcon(ref.harness)}
      {dot ? (
        <span
          {...surfaceAttributes(
            { radius: "pill" },
            "absolute -right-0.5 -bottom-0.5 flex  ring-2 ring-(--color-background-base) [&>span]:size-1.5",
          )}
        >
          {dot}
        </span>
      ) : null}
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
  for (const option of setting.options) {
    const ref = isDelegationSetting(setting) ? decodeAdvisor(option.value) : undefined;
    const provider = ref ? HARNESS_TITLE[ref.harness] : "";
    const parts = option.label.split(" · ");
    const primary = provider && parts.length > 1 ? parts[1] : t(option.label);
    const secondary = provider ? [provider, ...parts.slice(2)].join(" · ") : "";
    const item: DropdownMenuAction = {
      kind: "item",
      id: option.value,
      label: t(option.label),
      title: t(option.label),
      checked: delegationOptionSelected(setting, values, option.value),
      selectionRole: "checkbox",
      icon: <DelegationOptionIcon setting={setting} value={option.value} />,
      content: (
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <Text size="inherit" tone="inherit" truncate>
            {primary}
          </Text>
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
  const parts = option.label.split(" · ");
  return {
    label: ref && parts.length > 1 ? parts[1] : t(option.label),
    meta: ref ? [HARNESS_TITLE[ref.harness], ...parts.slice(2)].join(" · ") : undefined,
    group:
      ref &&
      new Set(setting.options.map((item) => decodeAdvisor(item.value)?.harness).filter(Boolean))
        .size > 1
        ? HARNESS_TITLE[ref.harness]
        : undefined,
  };
}
