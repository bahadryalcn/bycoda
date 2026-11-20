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
import { InfoPopover } from "../../../../shared/ui/InfoPopover";
import { InlineError } from "../../../../shared/ui/InlineError";
import { UsageMeter } from "../../../../shared/ui/UsageMeter";
import { DataTable, DataTableRow } from "../../../../shared/ui/SortableDataTable";
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
  // Subscription plans have no real dollar cost, so cost columns stay hidden until one is set.
  const anyCost =
    hasCap(draft.workCaps.total, ["costUsd"]) ||
    Object.values(draft.workCaps.providers).some((caps) => hasCap(caps, ["costUsd"]));
  const showCost = costOverride ?? anyCost;
  const columns = showCost ? [...TOKEN_COLUMNS, ...COST_COLUMNS] : TOKEN_COLUMNS;
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
      <Row label={t("Max concurrent tasks")}>
        <NumberField
          label={t("Max concurrent tasks")}
          hideLabel
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
      </Row>
      <Row label={t("Daily agent minutes")}>
        <NumberField
          label={t("Daily agent minutes")}
          hideLabel
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
      </Row>
      <Row label={t("Default maximum run minutes")} info={t("For one unattended run.")}>
        <NumberField
          label={t("Default maximum run minutes")}
          hideLabel
          min={1}
          max={10080}
          step={1}
          placeholder={t("No limit")}
          value={draft.maxRunMinutes}
          onChange={(event) => onChange({ ...draft, maxRunMinutes: event.currentTarget.value })}
        />
      </Row>
      <div className="flex flex-col gap-2 py-2">
        <div className="flex items-center gap-1">
          <Text size="secondary" weight="medium">
            {t("Token and cost limits")}
          </Text>
          <InfoPopover>
            <p>{t("Limits apply before new turns and may be exceeded by a running turn.")}</p>
          </InfoPopover>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={showCost}
            // A set cost value keeps the columns visible; the toggle only matters while all are empty.
            disabled={anyCost}
            onClick={() => setCostOverride(!showCost)}
          >
            {t("Cost limits")}
          </Button>
        </div>
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
        <DataTable
          caption={t("Token and cost limits")}
          headers={[
            { label: t("Provider") },
            ...columns.map((column) => ({ label: headers[column.key] })),
            { label: t("Keep free (%)") },
          ]}
        >
          {scopes.map((scope) => {
            const current = capsFor(draft, scope) ?? EMPTY_CAPS;
            const name = scope === "total" ? t("All providers") : HARNESS_TITLE[scope];
            return (
              <DataTableRow
                key={scope}
                cells={[
                  <Text key="provider" size="secondary" wrap="normal">
                    {name}
                  </Text>,
                  ...columns.map(({ key, period, metric }) => {
                    const update = (value: string) =>
                      setCaps(scope, {
                        ...current,
                        [period]: { ...current[period], [metric]: value },
                      });
                    return metric === "tokens" ? (
                      <TokenAmountField
                        key={key}
                        label={`${name}: ${headers[key]}`}
                        hideLabel
                        value={current[period][metric]}
                        onChange={update}
                        onInvalidChange={(invalid) => onFieldInvalid?.(`${scope}:${key}`, invalid)}
                      />
                    ) : (
                      <TextField
                        key={key}
                        numeric
                        type="number"
                        inputMode="decimal"
                        fieldSize="sm"
                        label={`${name}: ${headers[key]}`}
                        hideLabel
                        min={0}
                        step="any"
                        placeholder={t("No limit")}
                        startAdornment="$"
                        value={current[period][metric]}
                        onChange={(event) => update(event.currentTarget.value)}
                      />
                    );
                  }),
                  scope !== "total" && PLAN_QUOTA_PROVIDERS.includes(scope) ? (
                    <NumberField
                      key="reserve"
                      fieldSize="sm"
                      steppers={false}
                      label={`${name}: ${t("Keep free (%)")}`}
                      hideLabel
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
                  ) : null,
                ]}
              />
            );
          })}
        </DataTable>
      </div>
    </Group>
  );
}
