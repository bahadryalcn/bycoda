import { Button } from "../../../shared/ui/Button";
import { getLocale, t, useLocale } from "../../../shared/i18n";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "../../../shared/ui/icons";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { InlineError } from "../../../shared/ui/InlineError";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import {
  DAILY_SUMMARY_OPEN_EVENT,
  DAILY_SUMMARY_STORED_EVENT,
  gatherDailySummary,
  loadStoredDailySummary,
  takeSummaryPanelRequest,
} from "../model/dailySummaryClient";
import type { DailySummary, SummaryTask } from "../model/dailySummary";
import { formatAgentMinutes } from "../model/hostSettings";
import "./task-ops.css";

/** Day and time in the app language, never the system's: an English UI must not
 * show another language's weekday names. */
const summaryTime = (at: number) =>
  new Date(at).toLocaleString(getLocale(), {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** What the agents did over a period, across every machine. */
export function SummaryPanel({
  summary,
  busy,
  error,
  onRefresh,
  onOpenTask,
}: {
  summary: DailySummary | null;
  busy: boolean;
  error: string | null;
  onRefresh: () => void;
  onOpenTask: (key: string) => void;
}) {
  useLocale();
  const taskSection = (label: string, items: readonly SummaryTask[], note = "") =>
    items.length ? (
      <section aria-label={label} className="task-ops-section">
        <SectionLabel count={items.length}>
          {label}
          {note}
        </SectionLabel>
        <ul className="task-ops-frame">
          {items.map((item) => (
            <li key={item.key} className="task-ops-row">
              <Button
                variant="ghost"
                type="button"
                onClick={() => onOpenTask(item.key)}
                className="max-w-full truncate text-left"
              >
                {item.title}
              </Button>
              <span className="task-ops-caption">
                {item.project} · {item.machineName}
                {item.detail ? ` · ${item.detail}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>
    ) : null;
  const goalSection = (label: string, goals: DailySummary["goals"]) =>
    goals.length ? (
      <section aria-label={label} className="task-ops-section">
        <SectionLabel count={goals.length}>{label}</SectionLabel>
        <ul className="task-ops-frame">
          {goals.map((goal) => (
            <li key={`${goal.machineName}:${goal.title}`} className="task-ops-row">
              <span className="task-ops-title">{goal.title}</span>
              <span className="task-ops-caption task-ops-num">
                {goal.done}
                {t(" of ")}
                {goal.total}
                {t(" tasks done · ")}
                {goal.machineName}
              </span>
            </li>
          ))}
        </ul>
      </section>
    ) : null;
  const empty =
    summary != null &&
    !summary.finished.length &&
    !summary.blocked.length &&
    !summary.waiting.length &&
    !summary.suggestions.length &&
    !summary.goals.length &&
    !summary.goalsFinished.length;
  const kpis = summary
    ? [
        { label: t("Finished"), value: summary.finished.length },
        { label: t("Blocked"), value: summary.blocked.length },
        { label: t("Waiting for you"), value: summary.waiting.length },
        { label: t("New suggestions"), value: summary.suggestions.length },
      ]
    : [];
  return (
    <section aria-label={t("Summary")} className="task-ops-panel max-h-[45%]">
      <div className="task-ops-head">
        <p className="task-ops-caption task-ops-head-text">
          {summary
            ? t("From {p0} to {p1}", {
                p0: summaryTime(summary.since),
                p1: summaryTime(summary.until),
              })
            : t("No summary yet. One is sent every day at the time set in Settings.")}
        </p>
        <Button
          reserveLabels={[t("Refreshing…")]}
          variant="secondary"
          type="button"
          onClick={onRefresh}
          disabled={busy}
          loading={busy}
          startIcon={<RefreshCw className="icon-sm" strokeWidth={1.75} />}
        >
          {busy ? t("Refreshing…") : t("Refresh now")}
        </Button>
      </div>
      {error ? <InlineError>{error}</InlineError> : null}
      {summary ? (
        <>
          {empty ? (
            <EmptyState size="inline" description={t("No background activity.")} />
          ) : (
            <div className="task-ops-kpis">
              {kpis.map((kpi) => (
                <div key={kpi.label} className="task-ops-kpi">
                  <span className="task-ops-kpi-value">{kpi.value}</span>
                  <span className="task-ops-caption">{kpi.label}</span>
                </div>
              ))}
            </div>
          )}
          {taskSection(
            t("Finished"),
            summary.finished,
            summary.autoMerged
              ? ` ${t("({p0} merged automatically)", { p0: summary.autoMerged })}`
              : "",
          )}
          {taskSection(t("Blocked"), summary.blocked)}
          {taskSection(t("Waiting for you"), summary.waiting)}
          {taskSection(t("New suggestions"), summary.suggestions)}
          {goalSection(t("Goals in progress"), summary.goals)}
          {goalSection(t("Goals finished"), summary.goalsFinished)}
          {summary.usage.length ? (
            <section aria-label={t("Agent time")} className="task-ops-section">
              <SectionLabel>{t("Agent time today")}</SectionLabel>
              <ul className="task-ops-frame">
                {summary.usage.map((entry) => (
                  <li key={entry.machineName} className="task-ops-row">
                    <span className="task-ops-title">{entry.machineName}</span>
                    <span className="task-ops-caption task-ops-num">
                      {formatAgentMinutes(entry.usedMinutes)}
                      {entry.dailyAgentMinutes
                        ? t(" of {p0}", { p0: formatAgentMinutes(entry.dailyAgentMinutes) })
                        : ""}
                      {entry.usageUncertain ? ` · ${t("Incomplete")}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {summary.unreachable.length || summary.outdated.length ? (
            <p className="task-ops-caption">
              {t("Not included:")}{" "}
              {[
                ...summary.unreachable.map((name) => `${name} (not reachable)`),
                ...summary.outdated.map((name) => `${name} (host needs an update)`),
              ].join(", ")}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/** The daily summary panel: the last summary sent, or a fresh one built on
 * request. A click on the summary notification opens the panel, also when the
 * view was not showing yet. */
export function useDailySummaryPanel() {
  const [open, setOpen] = useState(false);
  const [stored, setStored] = useState(loadStoredDailySummary);
  const [fresh, setFresh] = useState<DailySummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const openRequested = () => {
      if (takeSummaryPanelRequest()) setOpen(true);
    };
    const storedChanged = () => setStored(loadStoredDailySummary());
    openRequested();
    window.addEventListener(DAILY_SUMMARY_OPEN_EVENT, openRequested);
    window.addEventListener(DAILY_SUMMARY_STORED_EVENT, storedChanged);
    return () => {
      window.removeEventListener(DAILY_SUMMARY_OPEN_EVENT, openRequested);
      window.removeEventListener(DAILY_SUMMARY_STORED_EVENT, storedChanged);
    };
  }, []);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      const at = Date.now();
      setFresh(await gatherDailySummary(at - 24 * 60 * 60 * 1000, at));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return { open, toggle, summary: fresh ?? stored, busy, error, refresh };
}
