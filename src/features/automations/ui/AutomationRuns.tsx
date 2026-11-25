import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { StatusText, type StatusTextTone } from "../../../shared/ui/StatusText";
import { Surface, surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { CircleAlert } from "../../../shared/ui/icons";
import { findTriggerEvent, triggerName } from "../model/automationTriggerCatalog";
import {
  automationScheduleLabel,
  formatAutomationRunAt,
  formatAutomationRunDuration,
  type AutomationDraft,
  type AutomationRun,
  type AutomationTriggerKind,
} from "../model/automations";
import { TriggerMark } from "./TriggerEditor";

const RUN_GRID =
  "grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1";
/** Matches the bounded native run read; a full page means older runs may exist beyond it. */
const RUN_HISTORY_LIMIT = 100;

/** The saved automation's latest runs. A failed read is never shown as an empty history. */
export function AutomationRuns({
  runs,
  loading,
  error,
  draft,
  onRefresh,
  onOpenTask,
  onOpenSession,
}: {
  runs: readonly AutomationRun[];
  loading: boolean;
  error: string | null;
  draft: AutomationDraft;
  onRefresh: () => void;
  onOpenTask?: (taskId: string) => void | Promise<void>;
  onOpenSession: (sessionId: string) => void | Promise<void>;
}) {
  useLocale();
  return (
    <section>
      <SectionLabel as="h2" className="px-1">
        {t("Recent runs")}
      </SectionLabel>
      {loading ? <LoadingText inset="row" /> : null}
      {error ? (
        <InlineError
          inset="row"
          className="mt-2"
          details={error}
          retry={{ onRetry: onRefresh, disabled: loading }}
        >
          {t("Could not load recent runs.")}
        </InlineError>
      ) : null}
      {runs.length > 0 ? (
        <Surface variant="card" padding="none" className="mt-2">
          <ul {...surfaceAttributes({ dividers: "pane" })}>
            {runs.slice(0, RUN_HISTORY_LIMIT).map((run) => (
              <RunRow
                key={run.id}
                run={run}
                draft={draft}
                onOpenSession={onOpenSession}
                onOpenTask={onOpenTask}
              />
            ))}
          </ul>
          {runs.length >= RUN_HISTORY_LIMIT ? (
            <Text as="div" size="micro" tone="muted" className="px-4 py-2">
              {t("Showing the latest {p0} runs. Older runs may not be shown.", {
                p0: RUN_HISTORY_LIMIT,
              })}
            </Text>
          ) : null}
        </Surface>
      ) : !loading && !error ? (
        <EmptyState description={t("This automation has not run yet.")} />
      ) : null}
    </section>
  );
}

function RunRow({
  onOpenTask,
  run,
  draft,
  onOpenSession,
}: {
  run: AutomationRun;
  onOpenTask?: (taskId: string) => void | Promise<void>;
  draft: AutomationDraft;
  onOpenSession: (sessionId: string) => void | Promise<void>;
}) {
  useLocale();
  const trigger = runTriggerMeta(run, draft);
  const sessionId = run.sessionId;
  return (
    <li>
      <Button
        type="button"
        disabled={!sessionId && !(run.taskId && onOpenTask)}
        disabledReason={
          sessionId || (run.taskId && onOpenTask) ? undefined : t("This run has no session yet")
        }
        onClick={() => {
          if (run.taskId && onOpenTask) {
            void onOpenTask(run.taskId);
            return;
          }
          if (!sessionId) return;
          void onOpenSession(sessionId);
        }}
        variant="item"
        className={`${RUN_GRID} w-full`}
      >
        <Text size="inherit" tone="neutral" className="flex min-w-0 items-center gap-2">
          <TriggerMark kind={trigger.kind} className="icon-sm shrink-0" tone="muted" />
          <Text size="inherit" tone="inherit" truncate className="min-w-0">
            {trigger.label}
          </Text>
        </Text>
        <Text size="inherit" tone="neutral" truncate>
          {formatAutomationRunAt(run.scheduledFor || run.createdAt)}
        </Text>
        <span>
          {/* Still running, but stuck until the owner answers. */}
          {run.status === "running" && run.needsInput ? (
            <Tooltip label={t("Needs input")}>
              <CircleAlert className="icon-sm" aria-label={t("Needs input")} />
            </Tooltip>
          ) : (
            <RunStatusPill status={run.status} />
          )}
        </span>
        <Text size="inherit" tone="muted" className="text-end tabular-nums">
          {formatAutomationRunDuration(run)}
        </Text>
      </Button>
      {run.error && (run.status === "failed" || run.status === "skipped") ? (
        <InlineError inset="row" details={run.error}>
          {t("Automation run failed or was skipped.")}
        </InlineError>
      ) : null}
    </li>
  );
}

export function RunStatusPill({ status }: { status: AutomationRun["status"] }) {
  return (
    <StatusText tone={runStatusTone(status)} className="shrink-0 whitespace-nowrap">
      {runStatusLabel(status)}
    </StatusText>
  );
}

function runStatusLabel(status: AutomationRun["status"]): string {
  if (status === "succeeded") return "Succeeded";
  if (status === "failed") return "Failed";
  if (status === "skipped") return "Skipped";
  if (status === "cancelled") return "Cancelled";
  if (status === "running") return "Running";
  return "Pending";
}

function runStatusTone(status: AutomationRun["status"]): StatusTextTone {
  if (status === "succeeded") return "done";
  if (status === "failed") return "failed";
  if (status === "skipped") return "needs-you";
  if (status === "running") return "running";
  return "idle";
}

function runTriggerMeta(
  run: AutomationRun,
  draft: AutomationDraft,
): { kind: AutomationTriggerKind; label: string } {
  if (run.trigger === "manual")
    return {
      kind: "time",
      get label() {
        return t("Test run");
      },
    };
  if (draft.hostTrigger?.kind === "continuous")
    return { kind: "time", label: automationScheduleLabel(draft) };
  if (draft.hostTrigger?.kind === "event") return { kind: "tasks", label: draft.hostTrigger.event };
  if (run.trigger === "event") {
    const kind = run.eventKind ?? draft.triggerKind;
    const event = run.event ?? draft.triggerEvent;
    return {
      kind,
      label: findTriggerEvent(kind, event)?.label ?? triggerName(kind),
    };
  }
  const times = draft.triggers.filter((trigger) => trigger.kind === "time");
  if (times[0]) {
    return {
      kind: "time",
      get label() {
        return t("Scheduled · {p0}", { p0: automationScheduleLabel(times[0]) });
      },
    };
  }
  const first = draft.triggers[0];
  if (!first)
    return {
      kind: "time",
      get label() {
        return t("Scheduled");
      },
    };
  const event = findTriggerEvent(first.kind, first.event)?.label ?? triggerName(first.kind);
  return { kind: first.kind, label: event };
}
