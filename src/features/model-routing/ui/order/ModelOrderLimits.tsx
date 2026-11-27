import { useState } from "react";
import { useT } from "../../../../shared/i18n";
import { HARNESS_TITLE } from "../../../../shared/model/harnessIdentity";
import { SessionProviderSchema } from "../../../../shared/model/host-contracts/session-commands";
import { NumberField } from "../../../../shared/ui/NumberField";
import { TokenAmountField } from "./TokenAmountField";
import { TextField } from "../../../../shared/ui/TextField";
import { Text } from "../../../../shared/ui/Text";
import { InfoTooltip } from "../../../../shared/ui/InfoPopover";
import { TriangleAlert } from "../../../../shared/ui/icons";
import { InlineError } from "../../../../shared/ui/InlineError";
import { UsageMeter } from "../../../../shared/ui/UsageMeter";
import { Select } from "../../../../shared/ui/Select";
import { Switch } from "../../../../shared/ui/Switch";
import { Group, Row } from "../../../../shared/ui/settings";
import {
  DEFAULT_MAX_RUNNING_TASKS,
  formatAgentMinutes,
  type MachineLimits,
} from "../../../tasks/public/hostSettings";
import type { CapDraft, OrderDraft } from "../../model/modelRoutingDraft";
import { limitedProviders, type HostProviders } from "../../model/hostProviders";

const EMPTY_CAPS: CapDraft = {
  daily: { tokens: "", costUsd: "" },
  weekly: { tokens: "", costUsd: "" },
  monthly: { tokens: "", costUsd: "" },
};
const TOKEN_COLUMNS = [
  { key: "daily-tokens", period: "daily", metric: "tokens" },
  { key: "weekly-tokens", period: "weekly", metric: "tokens" },
  { key: "monthly-tokens", period: "monthly", metric: "tokens" },
] as const;
const COST_COLUMNS = [
  { key: "daily-costUsd", period: "daily", metric: "costUsd" },
  { key: "weekly-costUsd", period: "weekly", metric: "costUsd" },
  { key: "monthly-costUsd", period: "monthly", metric: "costUsd" },
] as const;
/** Providers whose account quota the selector can read, so a "keep free" share means something. */
/** Providers whose plan quota Bycoda can read; only they take keep-free and unknown-limit settings. */
export const PLAN_QUOTA_PROVIDERS: readonly string[] = ["claude", "codex", "opencode"];

type CapScope = "total" | (typeof SessionProviderSchema.options)[number];

function capsFor(draft: OrderDraft, scope: CapScope): CapDraft | undefined {
  return scope === "total" ? draft.workCaps.total : draft.workCaps.providers[scope];
}

function hasCap(caps: CapDraft | undefined, metrics: ("tokens" | "costUsd")[]): boolean {
  return Boolean(
    caps &&
    [caps.daily, caps.weekly, caps.monthly].some((period) =>
      metrics.some((metric) => period[metric].trim() !== ""),
    ),
  );
}

export function ModelOrderLimits({
  draft,
  usage,
  hostProviders,
  onChange,
  onFieldInvalid,
}: {
  draft: OrderDraft;
  usage: MachineLimits;
  /** The edited Host's providers; without them only providers with saved values show. */
  hostProviders?: HostProviders;
  onChange: (draft: OrderDraft) => void;
  /** Token fields report by key whether they hold an unparsable value, which blocks Save. */
  onFieldInvalid?: (key: string, invalid: boolean) => void;
}) {
  const t = useT();
  const [costOverride, setCostOverride] = useState<boolean | null>(null);
  const [selectedScope, setSelectedScope] = useState<CapScope>("total");
  const hosted: HostProviders = hostProviders ?? { status: "loading" };
  const headers = {
    "daily-tokens": t("Daily tokens"),
    "daily-costUsd": t("Daily cost (USD)"),
    "weekly-tokens": t("Weekly tokens"),
    "weekly-costUsd": t("Weekly cost (USD)"),
    "monthly-tokens": t("Monthly tokens"),
    "monthly-costUsd": t("Monthly cost (USD)"),
  } as const;
  const scopes: CapScope[] = [
    "total",
    ...limitedProviders(
      SessionProviderSchema.options,
      hosted,
      (provider) =>
        hasCap(draft.workCaps.providers[provider], ["tokens", "costUsd"]) ||
        Boolean(draft.workCaps.reserve[provider]),
    ),
  ];
  const activeScope = scopes.includes(selectedScope) ? selectedScope : "total";
  // Subscription plans have no real dollar cost, so cost columns stay hidden until one is set.
  const anyCost =
    hasCap(draft.workCaps.total, ["costUsd"]) ||
    Object.values(draft.workCaps.providers).some((caps) => hasCap(caps, ["costUsd"]));
  const showCost = costOverride ?? anyCost;
  const setCaps = (scope: CapScope, next: CapDraft) =>
    onChange({
      ...draft,
      workCaps:
        scope === "total"
          ? { ...draft.workCaps, total: next }
          : { ...draft.workCaps, providers: { ...draft.workCaps.providers, [scope]: next } },
    });
  const usedText =
    usage.dailyAgentMinutes > 0
      ? t("{p0} of {p1}", {
          p0: formatAgentMinutes(usage.usedMinutes),
          p1: formatAgentMinutes(usage.dailyAgentMinutes),
        })
      : formatAgentMinutes(usage.usedMinutes);
  const used = usage.stale ? t("{p0} · {p1}", { p0: t("Out of date"), p1: usedText }) : usedText;
  const scopeCaps = capsFor(draft, activeScope) ?? EMPTY_CAPS;
  const updateCap = (period: keyof CapDraft, metric: "tokens" | "costUsd", value: string) =>
    setCaps(activeScope, {
      ...scopeCaps,
      [period]: { ...scopeCaps[period], [metric]: value },
    });
  // Turning cost limits off removes every cost limit, so none keeps applying out of view.
  const clearCosts = () => {
    const clear = (caps: CapDraft): CapDraft => ({
      daily: { ...caps.daily, costUsd: "" },
      weekly: { ...caps.weekly, costUsd: "" },
      monthly: { ...caps.monthly, costUsd: "" },
    });
    onChange({
      ...draft,
      workCaps: {
        ...draft.workCaps,
        total: clear(draft.workCaps.total),
        providers: Object.fromEntries(
          Object.entries(draft.workCaps.providers).map(([provider, caps]) => [
            provider,
            clear(caps),
          ]),
        ),
      },
    });
  };
  const setReserve = (value: string) =>
    onChange({
      ...draft,
      workCaps: {
        ...draft.workCaps,
        reserve: { ...draft.workCaps.reserve, [activeScope]: value },
      },
    });
  /**
   * One number limit as a row; a limit that can be absent gets a reset that removes it, and a
   * required limit with a default gets a reset that restores the default.
   */
  const limitRow = (
    label: string,
    value: string,
    set: (value: string) => void,
    field: {
      min: number;
      max?: number;
      optional?: boolean;
      defaultValue?: string;
      steppers?: boolean;
      placeholder?: string;
    },
  ) => (
    <Row
      label={label}
      controlWidth="aligned"
      modified={
        field.defaultValue !== undefined
          ? value.trim() !== field.defaultValue
          : field.optional === true && value.trim() !== ""
      }
      onReset={() => set(field.defaultValue ?? "")}
      resetLabel={field.defaultValue !== undefined ? undefined : t("Remove limit")}
    >
      <NumberField
        hideLabel
        fieldSize="sm"
        steppers={field.steppers}
        label={label}
        min={field.min}
        max={field.max}
        step={1}
        placeholder={field.placeholder ?? (field.optional ? t("No limit") : undefined)}
        value={value}
        onChange={(event) => set(event.currentTarget.value)}
      />
    </Row>
  );
  return (
    <>
      <Group
        title={t("Work limits")}
        layout="full"
        info={t("Caps for all unattended work on this computer.")}
      >
        <Row label={t("Used today")}>
          <div className="flex min-w-0 items-center justify-end gap-2">
            {usage.limitReached ? (
              <InfoTooltip
                label={t("Limit reached")}
                icon={<TriangleAlert className="icon-sm" aria-hidden />}
              >
                {t("Limit reached")}
              </InfoTooltip>
            ) : null}
            {usage.dailyAgentMinutes > 0 ? (
              // The meter has no width of its own; in a row that ends at the right it needs one.
              <div className="w-32 shrink-0">
                <UsageMeter
                  compact
                  showLegend={false}
                  label={t("Agent time used today")}
                  segments={[
                    {
                      id: "time",
                      label: t("Agent time used today"),
                      value: usage.usedMinutes,
                    },
                  ]}
                  limit={usage.dailyAgentMinutes}
                  tone={
                    usage.usedMinutes >= usage.dailyAgentMinutes
                      ? "danger"
                      : usage.usedMinutes >= usage.dailyAgentMinutes * 0.75
                        ? "warning"
                        : "neutral"
                  }
                  valueText={used}
                />
              </div>
            ) : null}
            <Text size="secondary" tone="secondary" className="whitespace-nowrap">
              {used}
            </Text>
          </div>
        </Row>
        {limitRow(
          t("Max concurrent tasks"),
          draft.limits.maxRunningTasks,
          (value) =>
            onChange({
              ...draft,
              limits: { ...draft.limits, maxRunningTasks: value },
            }),
          { min: 1, defaultValue: String(DEFAULT_MAX_RUNNING_TASKS) },
        )}
        {limitRow(
          t("Daily agent minutes"),
          draft.limits.dailyAgentMinutes,
          (value) =>
            onChange({
              ...draft,
              limits: { ...draft.limits, dailyAgentMinutes: value },
            }),
          { min: 0, optional: true },
        )}
        {limitRow(
          t("Default maximum run minutes"),
          draft.maxRunMinutes,
          (value) => onChange({ ...draft, maxRunMinutes: value }),
          { min: 1, max: 10080, optional: true },
        )}
      </Group>
      <Group
        title={t("Token and cost limits")}
        layout="full"
        info={t("Limits apply before new turns and may be exceeded by a running turn.")}
        action={
          <Select
            label={t("Provider")}
            hideLabel
            fieldSize="sm"
            value={activeScope}
            options={scopes.map((scope) => ({
              value: scope,
              label: scope === "total" ? t("All providers") : HARNESS_TITLE[scope],
            }))}
            onValueChange={(value) =>
              setSelectedScope(scopes.find((scope) => scope === value) ?? "total")
            }
          />
        }
        feedback={
          hosted.status === "loading" ? (
            <Text size="secondary" tone="secondary">
              {t("Loading…")}
            </Text>
          ) : hosted.status === "failed" ? (
            <InlineError>
              {t(
                "Providers on this Host could not be read. Only providers with saved limits are shown.",
              )}
            </InlineError>
          ) : undefined
        }
      >
        {TOKEN_COLUMNS.map(({ key, period }) => (
          <Row
            key={`${activeScope}:${key}`}
            label={headers[key]}
            controlWidth="aligned"
            modified={scopeCaps[period].tokens.trim() !== ""}
            onReset={() => updateCap(period, "tokens", "")}
            resetLabel={t("Remove limit")}
          >
            <div className="w-60 max-w-full">
              <TokenAmountField
                hideLabel
                label={headers[key]}
                value={scopeCaps[period].tokens}
                onChange={(value) => updateCap(period, "tokens", value)}
                onInvalidChange={(invalid) => onFieldInvalid?.(`${activeScope}:${key}`, invalid)}
              />
            </div>
          </Row>
        ))}
        {activeScope !== "total" && PLAN_QUOTA_PROVIDERS.includes(activeScope)
          ? limitRow(t("Keep free (%)"), draft.workCaps.reserve[activeScope] ?? "", setReserve, {
              min: 0,
              max: 100,
              optional: true,
              steppers: false,
              placeholder: "0",
            })
          : null}
        <Row label={t("Cost limits")}>
          <Switch
            aria-label={t("Cost limits")}
            checked={showCost}
            compact
            onCheckedChange={(on) => {
              setCostOverride(on);
              if (!on && anyCost) clearCosts();
            }}
          />
        </Row>
        {showCost
          ? COST_COLUMNS.map(({ key, period }) => (
              <Row
                key={`${activeScope}:${key}`}
                label={headers[key]}
                controlWidth="aligned"
                dependsOn
                modified={scopeCaps[period].costUsd.trim() !== ""}
                onReset={() => updateCap(period, "costUsd", "")}
                resetLabel={t("Remove limit")}
              >
                <TextField
                  hideLabel
                  numeric
                  type="number"
                  inputMode="decimal"
                  fieldSize="sm"
                  label={headers[key]}
                  min={0}
                  step="any"
                  placeholder={t("No limit")}
                  startAdornment="$"
                  value={scopeCaps[period].costUsd}
                  onChange={(event) => updateCap(period, "costUsd", event.currentTarget.value)}
                />
              </Row>
            ))
          : null}
      </Group>
    </>
  );
}
