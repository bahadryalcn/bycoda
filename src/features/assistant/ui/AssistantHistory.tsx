import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import type { AssistantActivity } from "../../../shared/model/host-contracts/assistant";
import { dateTimeFormat, t, useLocale } from "../../../shared/i18n";
import { ActionHost, InlineAction, InlineTextAction } from "../../../shared/ui/ActionHost";
import { Badge } from "../../../shared/ui/Badge";
import { LiveText } from "../../../shared/ui/LiveText";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Timestamp } from "../../../shared/ui/Timestamp";
import { ExternalLink } from "../../../shared/ui/icons";
import styles from "./AssistantHistory.module.css";

export const assistantActivityLabels: Record<string, string> = {
  "action.started": "Started",
  "action.completed": "Completed",
  "action.submitted": "Submitted",
  "action.accepted": "Accepted",
  "action.unknown": "Outcome unknown",
  "action.failed": "Failed",
  "action.refused": "Refused",
  "action.cancelled": "Cancelled",
  "action.pending": "Pending",
  "action.running": "Running",
  "action.waiting": "Waiting",
  "budget.exhausted": "Budget exhausted",
  "chief.woke": "Status reviewed",
  "conversation.replied": "Conversation reply",
  "job.received": "Job received",
  "job.replanned": "Job replanned",
  "job.started": "Job started",
  "job.unknown": "Dispatch status unknown",
  "job.pause": "Job paused",
  "job.resume": "Job resumed",
  "job.stop": "Job stopped",
  "memory.saved": "Memory saved",
  "profile.updated": "Settings updated",
  "task.started": "Task started",
  "job.waiting": "Waiting for you",
  "job.stalled": "Stalled",
  "job.problem": "Job problem",
};
/** Problems keep the danger tone; every other kind stays neutral. */
const DANGER_KINDS = new Set(["job.problem", "job.unknown", "action.failed", "action.unknown"]);

export function AssistantHistory({
  entries,
  filtered,
  onOpenSession,
  onJob,
}: {
  entries: AssistantActivity[];
  filtered: boolean;
  onOpenSession?: (id: string, environmentId?: string) => void | Promise<void>;
  onJob: (id: string) => void;
}) {
  // Subscribing re-renders the labels when the app language changes.
  const locale = useLocale();
  const groups = new Map<string, AssistantActivity[]>();
  // Calendar identity stays independent of the translated date label.
  for (const entry of [...entries].sort((left, right) => right.createdAt - left.createdAt)) {
    const date = new Date(entry.createdAt);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  return (
    <div className={styles.history}>
      {/* Always mounted so the empty state is announced when it first appears. */}
      <LiveText
        tone="secondary"
        className={styles.empty}
        text={!entries.length ? t(filtered ? "No results" : "No activity yet") : ""}
      />
      {[...groups].map(([key, events]) => (
        <section className={styles.day} key={key} aria-labelledby={`history-day-${key}`}>
          <SectionLabel as="h3" labelId={`history-day-${key}`} count={events.length}>
            {dateTimeFormat(locale, {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            }).format(new Date(events[0].createdAt))}
          </SectionLabel>
          <ol {...surfaceAttributes({ frame: "card", edge: "all", radius: "card" }, styles.events)}>
            {events.map((entry) => (
              <ActionHost
                as="li"
                {...surfaceAttributes({ separator: "pane-block" }, styles.event)}
                key={entry.id}
                hoverReveal
              >
                <Timestamp
                  className={styles.time}
                  format="time"
                  value={entry.createdAt}
                  size="caption"
                  tone="secondary"
                  leading="inherit"
                />
                <Text
                  as="p"
                  size="secondary"
                  tone="inherit"
                  leading="normal"
                  className={styles.summary}
                >
                  {entry.operation
                    ? `${entry.operation.tool} · ${entry.operation.target}`
                    : entry.summary}
                </Text>
                <Badge size="xs" tone={DANGER_KINDS.has(entry.kind) ? "danger" : "neutral"}>
                  {t(assistantActivityLabels[entry.kind] ?? "Activity")}
                </Badge>
                {(entry.jobId || (entry.sessionId && onOpenSession)) && (
                  <div className={styles.actions}>
                    {entry.jobId && (
                      <InlineTextAction reveal="interaction" onClick={() => onJob(entry.jobId!)}>
                        {t("Job")}
                      </InlineTextAction>
                    )}
                    {entry.sessionId && onOpenSession && (
                      <InlineAction
                        label={t("Open session")}
                        onClick={() => onOpenSession(entry.sessionId!)}
                      >
                        <ExternalLink className="icon-sm" />
                      </InlineAction>
                    )}
                  </div>
                )}
              </ActionHost>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
