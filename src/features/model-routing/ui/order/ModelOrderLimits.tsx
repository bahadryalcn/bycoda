import { useState } from "react";
import { useT } from "../../../../shared/i18n";
import { HARNESS_TITLE } from "../../../../shared/model/harnessIdentity";
import { SessionProviderSchema } from "../../../../shared/model/host-contracts/session-commands";
import { Button } from "../../../../shared/ui/Button";
import { NumberField } from "../../../../shared/ui/NumberField";
import { TokenAmountField } from "./TokenAmountField";
import { TextField } from "../../../../shared/ui/TextField";
import { Text } from "../../../../shared/ui/Text";
import { Badge } from "../../../../shared/ui/Badge";
import { InlineError } from "../../../../shared/ui/InlineError";
import { UsageMeter } from "../../../../shared/ui/UsageMeter";
import { Select } from "../../../../shared/ui/Select";
import { Group, Row } from "../../../../shared/ui/settings";
import { formatAgentMinutes, type MachineLimits } from "../../../tasks/public/hostSettings";
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
const PLAN_QUOTA_PROVIDERS: readonly string[] = ["claude", "codex", "opencode"];

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
  return (
    <>
      <Group
        title={t("Work limits")}
        layout="full"
        info={t("Caps for all unattended work on this computer.")}
      >
        <Row label={t("Used today")}>
          <div className="flex min-w-0 items-center gap-2">
            {usage.limitReached ? (
              <Badge size="xs" tone="danger">
                {t("Limit reached")}
              </Badge>
            ) : null}
            {usage.dailyAgentMinutes > 0 ? (
              <UsageMeter
                compact
                showLegend={false}
                unknown={usage.usageUncertain}
                label={t("Agent time used today")}
                segments={[
                  { id: "time", label: t("Agent time used today"), value: usage.usedMinutes },
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
            ) : null}
            <Text size="secondary" tone="secondary" className="whitespace-nowrap">
              {used}
            </Text>
          </div>
        </Row>
        {usage.usageUncertain ? (
          <InlineError>
            {usage.dailyAgentMinutes > 0
              ? t(
                  "Today's agent time is incomplete. New work waits until tomorrow while a daily limit is set.",
                )
              : t("Today's agent time is incomplete.")}
          </InlineError>
        ) : null}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] items-end gap-3 px-4 py-3">
          <NumberField
            label={t("Max concurrent tasks")}
            aria-label={t("Max concurrent tasks")}
            min={1}
            step={1}
            value={draft.limits.maxRunningTasks}
            onChange={(event) =>
              onChange({
                ...draft,
                limits: { ...draft.limits, maxRunningTasks: event.currentTarget.value },
              })
            }
          />
          <NumberField
            label={t("Daily agent minutes")}
            aria-label={t("Daily agent minutes")}
            min={0}
            step={1}
            placeholder={t("No limit")}
            value={draft.limits.dailyAgentMinutes}
            onChange={(event) =>
              onChange({
                ...draft,
                limits: { ...draft.limits, dailyAgentMinutes: event.currentTarget.value },
              })
            }
          />
          <NumberField
            label={t("Default maximum run minutes")}
            aria-label={t("Default maximum run minutes")}
            min={1}
            max={10080}
            step={1}
            placeholder={t("No limit")}
            value={draft.maxRunMinutes}
            onChange={(event) => onChange({ ...draft, maxRunMinutes: event.currentTarget.value })}
          />
        </div>
      </Group>
      <Group
        title={t("Token and cost limits")}
        layout="full"
        info={t("Limits apply before new turns and may be exceeded by a running turn.")}
        action={
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={showCost}
            onClick={() => setCostOverride(!showCost)}
          >
            {t("Cost limits")}
          </Button>
        }
      >
        <div className="flex flex-col gap-2 px-4 py-3">
          {hosted.status === "loading" ? (
            <Text size="secondary" tone="secondary">
              {t("Loading…")}
            </Text>
          ) : null}
          {hosted.status === "failed" ? (
            <InlineError>
              {t(
                "Providers on this Host could not be read. Only providers with saved limits are shown.",
              )}
            </InlineError>
          ) : null}
          <Select
            label={t("Provider")}
            value={activeScope}
            options={scopes.map((scope) => ({
              value: scope,
              label: scope === "total" ? t("All providers") : HARNESS_TITLE[scope],
            }))}
            onValueChange={(value) =>
              setSelectedScope(scopes.find((scope) => scope === value) ?? "total")
            }
          />
          {scopes.map((scope) => {
            const current = capsFor(draft, scope) ?? EMPTY_CAPS;
            const update = (period: keyof CapDraft, metric: "tokens" | "costUsd", value: string) =>
              setCaps(scope, { ...current, [period]: { ...current[period], [metric]: value } });
            return (
              <div key={scope} hidden={scope !== activeScope}>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-3">
                  {TOKEN_COLUMNS.map(({ key, period }) => (
                    <TokenAmountField
                      key={key}
                      label={headers[key]}
                      value={current[period].tokens}
                      onChange={(value) => update(period, "tokens", value)}
                      onInvalidChange={(invalid) => onFieldInvalid?.(`${scope}:${key}`, invalid)}
                    />
                  ))}
                </div>
                {showCost ? (
                  <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-3">
                    {COST_COLUMNS.map(({ key, period }) => (
                      <TextField
                        key={key}
                        numeric
                        type="number"
                        inputMode="decimal"
                        fieldSize="sm"
                        label={headers[key]}
                        min={0}
                        step="any"
                        placeholder={t("No limit")}
                        startAdornment="$"
                        value={current[period].costUsd}
                        onChange={(event) => update(period, "costUsd", event.currentTarget.value)}
                      />
                    ))}
                  </div>
                ) : null}
                {scope !== "total" && PLAN_QUOTA_PROVIDERS.includes(scope) ? (
                  <div className="mt-3 max-w-40">
                    <NumberField
                      fieldSize="sm"
                      steppers={false}
                      label={t("Keep free (%)")}
                      min={0}
                      max={100}
                      step={1}
                      placeholder="0"
                      value={draft.workCaps.reserve[scope] ?? ""}
                      onChange={(event) =>
                        onChange({
                          ...draft,
                          workCaps: {
                            ...draft.workCaps,
                            reserve: {
                              ...draft.workCaps.reserve,
                              [scope]: event.currentTarget.value,
                            },
                          },
                        })
                      }
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </Group>
    </>
  );
}
