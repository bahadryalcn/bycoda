import { useT } from "../../../../shared/i18n";
import { HARNESS_TITLE } from "../../../../shared/model/harnessIdentity";
import { SessionProviderSchema } from "../../../../shared/model/host-contracts/session-commands";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { NumberField } from "../../../../shared/ui/NumberField";
import { Text } from "../../../../shared/ui/Text";
import { Badge } from "../../../../shared/ui/Badge";
import { InlineError } from "../../../../shared/ui/InlineError";
import { UsageMeter } from "../../../../shared/ui/UsageMeter";
import { Group, Row } from "../../../settings/public/settingsControls";
import { formatAgentMinutes, type MachineLimits } from "../../../tasks/public/hostSettings";
import type { CapDraft, OrderDraft } from "../../model/modelRoutingDraft";

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
  const used = `${usage.stale ? `${t("Out of date")} · ` : ""}${formatAgentMinutes(usage.usedMinutes)}${
    usage.dailyAgentMinutes > 0
      ? t(" of {p0}", { p0: formatAgentMinutes(usage.dailyAgentMinutes) })
      : ""
  }`;
  return (
    <Group
      title={t("Work limits")}
      layout="full"
      description={t("Caps for all unattended work on this computer.")}
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
      <Row label={t("Daily agent minutes")} description={t("0 means no limit.")}>
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
        description={t("For one unattended run. Empty means no limit.")}
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
      <Disclosure summary={t("Token and cost limits")} variant="row">
        <Text size="secondary" tone="secondary">
          {t(
            "Empty or 0 means no limit. Limits apply before new turns and may be exceeded by a running turn.",
          )}
        </Text>
        {(["total", ...SessionProviderSchema.options] as const).map((scope) => {
          const caps = scope === "total" ? draft.workCaps.total : draft.workCaps.providers[scope];
          const empty: CapDraft = {
            daily: { tokens: "", costUsd: "" },
            monthly: { tokens: "", costUsd: "" },
          };
          const current = caps ?? empty;
          return (
            <Disclosure
              key={scope}
              summary={scope === "total" ? t("All providers") : HARNESS_TITLE[scope]}
              variant="row"
            >
              {(["daily", "monthly"] as const).flatMap((period) =>
                (["tokens", "costUsd"] as const).map((metric) => {
                  const label =
                    period === "daily"
                      ? metric === "tokens"
                        ? t("Daily tokens")
                        : t("Daily cost (USD)")
                      : metric === "tokens"
                        ? t("Monthly tokens")
                        : t("Monthly cost (USD)");
                  return (
                    <Row key={`${period}-${metric}`} label={label}>
                      <NumberField
                        label={label}
                        hideLabel
                        min={0}
                        step={metric === "tokens" ? 1 : "any"}
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
                    </Row>
                  );
                }),
              )}
            </Disclosure>
          );
        })}
      </Disclosure>
    </Group>
  );
}
