import { Tooltip } from "../../../shared/ui/Tooltip";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { useMemo, useState } from "react";
import { formatDate, formatNumber, t, useLocale } from "../../../shared/i18n";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Heading } from "../../../shared/ui/Heading";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Select } from "../../../shared/ui/Select";
import { SortableDataTable } from "../../../shared/ui/SortableDataTable";
import {
  providerAccountColorValue,
  type ProviderAccount,
} from "../../providers/model/providerAccounts";
import { useRateLimitHistory } from "../../providers/model/rateLimitHistory";
import type { UsageFilters, UsageWindow } from "../model/usageAnalytics";
import { usageLabel } from "./UsageVisualizations";
import { UsageProviderIdentity, usageProviderLabel } from "./UsageProviderIdentity";
import { HarnessIcon } from "../../../shared/ui/identity/HarnessIcon";

const accountKey = (account: ProviderAccount) => `${account.provider}:${account.id}`;
const accountLabel = (account: ProviderAccount) =>
  `${usageProviderLabel(account.provider)} · ${usageLabel(account.label)}`;
const observationTime = (value: number) =>
  formatDate(value, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
const percent = (value: number) =>
  `${formatNumber(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

export function QuotaHistory({
  window,
  filters,
  accounts,
}: {
  window: UsageWindow;
  filters: UsageFilters;
  accounts: ProviderAccount[];
}) {
  useLocale();
  const history = useRateLimitHistory();
  const [selectedKind, setKind] = useState<string | null>(null);
  const [account, setAccount] = useState("");
  const knownAccounts = useMemo(
    () =>
      accounts.filter(
        (a) =>
          (!filters.provider.length || filters.provider.includes(a.provider)) &&
          (!filters.account.length || filters.account.includes(`${a.provider}:${a.id}`)),
      ),
    [accounts, filters],
  );
  const key = knownAccounts.some((a) => accountKey(a) === account) ? account : "";
  const visibleAccounts = knownAccounts.filter((a) => !key || accountKey(a) === key);
  const accountMap = new Map(visibleAccounts.map((a) => [accountKey(a), a]));
  const samples = history.filter(
    (sample) =>
      accountMap.has(sample.account) && sample.at >= window.start && sample.at < window.end,
  );
  const kind = selectedKind ?? samples[0]?.kind ?? "session";
  const rows = samples.filter((s) => s.kind === kind);
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (row.at >= (latest.get(row.account)?.at ?? -Infinity)) latest.set(row.account, row);
  }
  const width = window.end - window.start;
  return (
    <section
      {...surfaceAttributes(
        { frame: "card", edge: "all", radius: "card", variant: "card" },
        "usage-panel",
      )}
    >
      <div className="usage-section-heading">
        <div className="flex items-center gap-2">
          <Heading size="item" level={3}>
            {t("Limit history")}
          </Heading>
          <InfoPopover label={t("About limit history")}>
            {t(
              "Actual account-wide readings, collected when limits refresh. History starts with collection; gaps and resets are not interpolated. Project and model filters do not apply to account quotas.",
            )}
          </InfoPopover>
        </div>
        <div className="usage-controls">
          <SearchableSelect
            hideLabel
            label={t("Account")}
            value={key}
            onChange={setAccount}
            options={[
              { value: "", label: t("All accounts") },
              ...knownAccounts.map((a) => ({
                value: accountKey(a),
                label: accountLabel(a),
                icon: <HarnessIcon harness={a.provider} size="sm" />,
              })),
            ]}
          />
          <Select
            hideLabel
            label={t("Limit window")}
            value={kind}
            onValueChange={setKind}
            options={[
              { value: "session", label: t("Session") },
              { value: "weekly", label: t("Weekly") },
              { value: "monthly", label: t("Monthly") },
            ]}
          />
        </div>
      </div>
      <Text as="div" size="caption" tone="inherit" leading="inherit" className="usage-quota-legend">
        {visibleAccounts.map((a) => {
          const sample = latest.get(accountKey(a));
          return (
            <div
              className="usage-quota-legend-item"
              key={accountKey(a)}
              data-account={accountKey(a)}
            >
              <span
                aria-hidden
                {...surfaceAttributes({ radius: "pill" }, "usage-quota-legend-dot")}
                style={{ background: providerAccountColorValue(a) }}
              />
              <UsageProviderIdentity provider={a.provider} label={accountLabel(a)} />
              <Tooltip label={sample ? observationTime(sample.at) : undefined} asChild>
                <Text size="inherit" tone="secondary" className="usage-quota-legend-value">
                  {sample ? percent(sample.used) : t("No records")}
                </Text>
              </Tooltip>
            </div>
          );
        })}
      </Text>
      {rows.length ? (
        <>
          <div
            className="usage-quota-plot"
            role="img"
            aria-label={`${t("Limit history")}: ${rows.length} ${t("recorded samples")}`}
          >
            <Text size="caption" tone="secondary" leading="inherit" className="usage-quota-max">
              100%
            </Text>
            <Text size="caption" tone="secondary" leading="inherit" className="usage-quota-zero">
              0%
            </Text>
            {rows.map((row) => (
              <Tooltip
                key={`${row.account}:${row.kind}:${row.at}`}
                label={`${accountLabel(accountMap.get(row.account)!)} · ${observationTime(row.at)}: ${percent(row.used)}`}
                asChild
              >
                <span
                  className="usage-quota-point"
                  key={`${row.account}:${row.kind}:${row.at}`}

                  style={{
                    background: providerAccountColorValue(accountMap.get(row.account)!),
                    insetInlineStart: `${((row.at - window.start) / width) * 100}%`,
                    insetBlockEnd: `${row.used}%`,
                  }}
                />
              </Tooltip>
            ))}
          </div>
          <Text as="p" leading="inherit" className="usage-quota-axis usage-muted">
            <span>{observationTime(window.start)}</span>
            <span>
              {t("Used (%)")} · {observationTime(window.end)}
            </span>
          </Text>
          <Disclosure size="sm" summary={t("Show as table")}>
            <Text as="div" leading="inherit">
              <div
                className="usage-history-table"
                role="region"
                aria-label={t("Limit history")}
                tabIndex={0}
              >
                <SortableDataTable
                  caption={t("Limit history")}
                  rowKey="key"
                  rows={rows
                    .slice(-100)
                    .reverse()
                    .map((s) => ({
                      key: `${s.account}:${s.kind}:${s.at}`,
                      account: accountLabel(accountMap.get(s.account)!),
                      at: s.at,
                      time: s.at,
                      used: s.used,
                      minutes: s.minutes,
                      reset: s.resetsAt ?? null,
                    }))}
                  columns={[
                    { key: "account", label: t("Account") },
                    {
                      key: "time",
                      label: t("Time"),
                      render: (v) => observationTime(Number(v)),
                    },
                    {
                      key: "used",
                      label: t("Used (%)"),
                      numeric: true,
                      render: (v) => percent(Number(v)),
                    },
                    {
                      key: "minutes",
                      label: t("Window (minutes)"),
                      numeric: true,
                      render: (value) =>
                        `${Number(value) % 60 === 0 ? `${Number(value) / 60}h` : `${Number(value)}m`} (${value})`,
                    },
                    {
                      key: "reset",
                      label: t("Reset"),
                      render: (v) =>
                        v == null ? t("Reset time unavailable") : observationTime(Number(v)),
                    },
                  ]}
                />
              </div>
            </Text>
            <Text as="p" leading="inherit" className="usage-muted">
              {t("Latest 100 samples in the selected interval.")}
            </Text>
          </Disclosure>
        </>
      ) : (
        <EmptyState
          size="inline"
          title={t("No recorded limit history for this account and interval yet.")}
          description=""
        />
      )}
    </section>
  );
}
