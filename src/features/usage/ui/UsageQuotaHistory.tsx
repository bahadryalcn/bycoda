import { useMemo, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Select } from "../../../shared/ui/Select";
import { SortableDataTable } from "../../../shared/ui/SortableDataTable";
import {
  providerAccountColorValue,
  type ProviderAccount,
} from "../../providers/model/providerAccounts";
import { useRateLimitHistory } from "../../providers/model/rateLimitHistory";
import type { UsageFilters, UsageWindow } from "../model/usageAnalytics";

export function QuotaHistory({
  window,
  filters,
  accounts,
}: {
  window: UsageWindow;
  filters: UsageFilters;
  accounts: ProviderAccount[];
}) {
  const locale = useLocale();
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
  const selected =
    knownAccounts.find((a) => `${a.provider}:${a.id}` === account) ??
    knownAccounts.find((a) =>
      history.some(
        (sample) =>
          sample.account === `${a.provider}:${a.id}` &&
          sample.at >= window.start &&
          sample.at < window.end,
      ),
    ) ??
    knownAccounts[0];
  const key = selected ? `${selected.provider}:${selected.id}` : "";
  const kind =
    selectedKind ??
    history.find(
      (sample) => sample.account === key && sample.at >= window.start && sample.at < window.end,
    )?.kind ??
    "session";
  const rows = history.filter(
    (s) => s.account === key && s.kind === kind && s.at >= window.start && s.at < window.end,
  );
  const width = window.end - window.start;
  return (
    <section className="usage-panel">
      <div className="usage-section-heading">
        <h3>{t("Limit history")}</h3>
        <div className="usage-controls">
          <Select
            label={t("Account")}
            value={key}
            onValueChange={setAccount}
            options={knownAccounts.map((a) => ({
              value: `${a.provider}:${a.id}`,
              label: `${a.provider} · ${a.label}`,
            }))}
          />
          <Select
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
      <p className="usage-muted">
        {t(
          "Actual account-wide readings, collected when limits refresh. History starts with collection; gaps and resets are not interpolated. Project and model filters do not apply to account quotas.",
        )}
      </p>
      {rows.length ? (
        <>
          <div
            className="usage-quota-plot"
            role="img"
            aria-label={`${t("Limit history")}: ${rows.length} ${t("recorded samples")}`}
          >
            <span className="usage-quota-max">100%</span>
            <span className="usage-quota-zero">0%</span>
            {rows.map((row) => (
              <span
                className="usage-quota-point"
                key={row.at}
                title={`${new Date(row.at).toLocaleString(locale)}: ${row.used.toFixed(1)}%`}
                style={{
                  background: selected ? providerAccountColorValue(selected) : undefined,
                  insetInlineStart: `${((row.at - window.start) / width) * 100}%`,
                  insetBlockEnd: `${row.used}%`,
                }}
              />
            ))}
          </div>
          <details>
            <summary>{t("Show as table")}</summary>
            <SortableDataTable
              caption={t("Limit history")}
              rowKey="key"
              rows={rows
                .slice(-100)
                .reverse()
                .map((s) => ({
                  key: String(s.at),
                  at: s.at,
                  time: new Date(s.at).toLocaleString(locale),
                  used: s.used,
                  minutes: s.minutes,
                  reset: s.resetsAt
                    ? new Date(s.resetsAt).toLocaleString(locale)
                    : t("Reset time unavailable"),
                }))}
              columns={[
                { key: "time", label: t("Time") },
                {
                  key: "used",
                  label: t("Used (%)"),
                  numeric: true,
                  render: (v) => `${Number(v).toFixed(1)}%`,
                },
                { key: "minutes", label: t("Window (minutes)"), numeric: true },
                { key: "reset", label: t("Reset") },
              ]}
            />
            <p className="usage-muted">{t("Latest 100 samples in the selected interval.")}</p>
          </details>
        </>
      ) : (
        <p className="usage-empty">
          {t("No recorded limit history for this account and interval yet.")}
        </p>
      )}
    </section>
  );
}
