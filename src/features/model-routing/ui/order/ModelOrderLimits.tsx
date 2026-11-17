import { useSyncExternalStore } from "react";
import {
  getHarnessAvailabilitySnapshot,
  isHarnessAvailable,
  subscribeHarnessAvailability,
} from "../../../../integrations/harness/core/availability";
import { useT } from "../../../../shared/i18n";
import { HARNESS_TITLE } from "../../../../shared/model/harnessIdentity";
import { SessionProviderSchema } from "../../../../shared/model/host-contracts/session-commands";
import { NumberField } from "../../../../shared/ui/NumberField";
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

const EMPTY_CAPS: CapDraft = {
  daily: { tokens: "", costUsd: "" },
  monthly: { tokens: "", costUsd: "" },
};
const CAP_COLUMNS = [
  { key: "daily-tokens", period: "daily", metric: "tokens" },
  { key: "daily-costUsd", period: "daily", metric: "costUsd" },
  { key: "monthly-tokens", period: "monthly", metric: "tokens" },
  { key: "monthly-costUsd", period: "monthly", metric: "costUsd" },
] as const;

type CapScope = "total" | (typeof SessionProviderSchema.options)[number];

function capsFor(draft: OrderDraft, scope: CapScope): CapDraft | undefined {
  return scope === "total" ? draft.workCaps.total : draft.workCaps.providers[scope];
}

function hasCap(caps: CapDraft | undefined): boolean {
  return Boolean(
    caps &&
    [caps.daily.tokens, caps.daily.costUsd, caps.monthly.tokens, caps.monthly.costUsd].some(
      (value) => value.trim() !== "",
    ),
  );
}

export function ModelOrderLimits({
  draft,
  usage,
  onChange,
}: {
  draft: OrderDraft;
  usage: MachineLimits;
  onChange: (draft: OrderDraft) => void;
}) {
  const t = useT();
  useSyncExternalStore(
    subscribeHarnessAvailability,
    getHarnessAvailabilitySnapshot,
    getHarnessAvailabilitySnapshot,
  );
  const headers = {
    "daily-tokens": t("Daily tokens"),
    "daily-costUsd": t("Daily cost (USD)"),
    "monthly-tokens": t("Monthly tokens"),
    "monthly-costUsd": t("Monthly cost (USD)"),
  } as const;
  const scopes: CapScope[] = [
    "total",
    ...SessionProviderSchema.options.filter(
      (provider) =>
        isHarnessAvailable(provider as Parameters<typeof isHarnessAvailable>[0]) ||
        hasCap(draft.workCaps.providers[provider]),
    ),
  ];
  const used = `${usage.stale ? `${t("Out of date")} · ` : ""}${formatAgentMinutes(usage.usedMinutes)}${
    usage.dailyAgentMinutes > 0
      ? t(" of {p0}", { p0: formatAgentMinutes(usage.dailyAgentMinutes) })
      : ""
  }`;
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
      <Row label={t("Daily agent minutes")} info={t("0 means no limit.")}>
        <NumberField
          label={t("Daily agent minutes")}
          hideLabel
          min={0}
          step={1}
          value={draft.limits.dailyAgentMinutes}
          onChange={(event) =>
            onChange({
              ...draft,
              limits: { ...draft.limits, dailyAgentMinutes: event.currentTarget.value },
            })
          }
        />
      </Row>
      <Row
        label={t("Default maximum run minutes")}
        info={t("For one unattended run. Empty means no limit.")}
      >
        <NumberField
          label={t("Default maximum run minutes")}
          hideLabel
          min={1}
          max={10080}
          step={1}
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
            <p>
              {t(
                "Empty or 0 means no limit. Limits apply before new turns and may be exceeded by a running turn.",
              )}
            </p>
          </InfoPopover>
        </div>
        <DataTable
          caption={t("Token and cost limits")}
          headers={[
            { label: t("Provider") },
            ...CAP_COLUMNS.map((column) => ({ label: headers[column.key] })),
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
                  ...CAP_COLUMNS.map(({ key, period, metric }) => (
                    <TextField
                      key={key}
                      numeric
                      type="number"
                      inputMode="decimal"
                      fieldSize="sm"
                      label={`${name}: ${headers[key]}`}
                      hideLabel
                      min={0}
                      step={metric === "tokens" ? 1 : "any"}
                      placeholder={t("No limit")}
                      startAdornment={metric === "costUsd" ? "$" : undefined}
                      value={current[period][metric]}
                      onChange={(event) => {
                        const next = {
                          ...current,
                          [period]: { ...current[period], [metric]: event.currentTarget.value },
                        };
                        onChange({
                          ...draft,
                          workCaps:
                            scope === "total"
                              ? { ...draft.workCaps, total: next }
                              : {
                                  ...draft.workCaps,
                                  providers: { ...draft.workCaps.providers, [scope]: next },
                                },
                        });
                      }}
                    />
                  )),
                ]}
              />
            );
          })}
        </DataTable>
      </div>
    </Group>
  );
}
