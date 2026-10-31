import { Button } from "../../../shared/ui/Button";
import { getLocale, t, useLocale } from "../../../shared/i18n";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "../../../shared/ui/icons";
import {
  DAILY_SUMMARY_OPEN_EVENT,
  DAILY_SUMMARY_STORED_EVENT,
  gatherDailySummary,
  loadStoredDailySummary,
  takeSummaryPanelRequest,
} from "../model/dailySummaryClient";
import type { DailySummary, SummaryTask } from "../model/dailySummary";
import { formatAgentMinutes } from "../model/hostSettings";

/** Day and time in the app language, never the system's: an English UI must not
 * show another language's weekday names. */
const summaryTime = (at: number) =>
  new Date(at).toLocaleString(getLocale(), {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const SUMMARY_HEADING =
  "text-ui-micro font-medium uppercase tracking-wide text-(--ui-text-secondary)";

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
      <section aria-label={label} className="flex flex-col gap-1">
        <h3 className={SUMMARY_HEADING}>
          {label} · {items.length}
          {note}
        </h3>
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => (
            <li key={item.key} className="min-w-0 text-ui-caption text-(--ui-text-secondary)">
              <Button
                variant="ghost"
                type="button"
                onClick={() => onOpenTask(item.key)}
                className="max-w-full truncate text-left"
              >
                {item.title}
              </Button>{" "}
              <span className="text-(--ui-text-secondary)">
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
      <section aria-label={label} className="flex flex-col gap-1">
        <h3 className={SUMMARY_HEADING}>
          {label} · {goals.length}
        </h3>
        <ul className="flex flex-col gap-0.5">
          {goals.map((goal) => (
            <li
              key={`${goal.machineName}:${goal.title}`}
              className="text-ui-caption text-(--ui-text-secondary)"
            >
              <span className="font-medium text-(--ui-text-secondary)">{goal.title}</span>{" "}
              <span className="text-(--ui-text-secondary)">
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
  return (
    <section
      aria-label={t("Summary")}
      className="flex max-h-[45%] shrink-0 flex-col gap-3 overflow-y-auto border-b border-(--ui-tone-neutral-border) p-3"
    >
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-ui-caption text-(--ui-text-secondary)">
          {summary
            ? t("From {p0} to {p1}", {
                p0: summaryTime(summary.since),
                p1: summaryTime(summary.until),
              })
            : t("No summary yet. One is sent every day at the time set in Settings.")}
        </p>
        <Button reserveLabels={[t("Refreshing…")]}
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
      {error ? <p className="text-ui-caption text-(--ui-tone-danger-fg)">{error}</p> : null}
      {summary ? (
        <>
          {empty ? (
            <p className="text-ui-caption text-(--ui-text-secondary)">
              {t("No background activity.")}
            </p>
          ) : null}
          {taskSection(
            "Finished",
            summary.finished,
            summary.autoMerged ? ` (${summary.autoMerged} merged automatically)` : "",
          )}
          {taskSection("Blocked", summary.blocked)}
          {taskSection("Waiting for you", summary.waiting)}
          {taskSection("New suggestions", summary.suggestions)}
          {goalSection("Goals in progress", summary.goals)}
          {goalSection("Goals finished", summary.goalsFinished)}
          {summary.usage.length ? (
            <section aria-label={t("Agent time")} className="flex flex-col gap-1">
              <h3 className={SUMMARY_HEADING}>{t("Agent time today")}</h3>
              <ul className="flex flex-col gap-0.5">
                {summary.usage.map((entry) => (
                  <li
                    key={entry.machineName}
                    className="text-ui-caption text-(--ui-text-secondary)"
                  >
                    <span className="font-medium text-(--ui-text-secondary)">
                      {entry.machineName}
                    </span>{" "}
                    {formatAgentMinutes(entry.usedMinutes)}
                    {entry.dailyAgentMinutes
                      ? t(" of {p0}", { p0: formatAgentMinutes(entry.dailyAgentMinutes) })
                      : ""}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {summary.unreachable.length || summary.outdated.length ? (
            <p className="text-ui-caption text-(--ui-text-secondary)">
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
