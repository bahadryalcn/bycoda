import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import type { AssistantActivity } from "../../../shared/model/host-contracts/assistant";
import { dateTimeFormat, t, useLocale } from "../../../shared/i18n";
import { ActionHost, InlineAction } from "../../../shared/ui/ActionHost";
import { Badge } from "../../../shared/ui/Badge";
import { LiveText } from "../../../shared/ui/LiveText";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Timestamp } from "../../../shared/ui/Timestamp";
import { Briefcase, ExternalLink } from "../../../shared/ui/icons";
import styles from "./AssistantHistory.module.css";

/** The translated label of an activity kind; call it while rendering. */
export function assistantActivityLabel(kind: string): string {
  switch (kind) {
    case "action.started":
      return t("Started");
    case "action.completed":
      return t("Completed");
    case "action.submitted":
      return t("Submitted");
    case "action.accepted":
      return t("Accepted");
    case "action.unknown":
      return t("Outcome unknown");
    case "action.failed":
      return t("Failed");
    case "action.refused":
      return t("Refused");
    case "action.cancelled":
      return t("Cancelled");
    case "action.pending":
      return t("Pending");
    case "action.running":
      return t("Running");
    case "action.waiting":
      return t("Waiting");
    case "budget.exhausted":
      return t("Budget exhausted");
    case "chief.woke":
      return t("Status reviewed");
    case "conversation.replied":
      return t("Conversation reply");
    case "job.received":
      return t("Job received");
    case "job.replanned":
      return t("Job replanned");
    case "job.started":
      return t("Job started");
    case "job.unknown":
      return t("Dispatch status unknown");
    case "job.pause":
      return t("Job paused");
    case "job.resume":
      return t("Job resumed");
    case "job.stop":
      return t("Job stopped");
    case "memory.saved":
      return t("Memory saved");
    case "profile.updated":
      return t("Settings updated");
    case "task.started":
      return t("Task started");
    case "job.waiting":
      return t("Waiting for you");
    case "job.stalled":
      return t("Stalled");
    case "job.problem":
      return t("Job problem");
    default:
      return t("Activity");
  }
}
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
        text={!entries.length ? (filtered ? t("No results") : t("No activity yet")) : ""}
      />
      {[...groups].map(([key, events]) => (
        <section className={styles.day} key={key} aria-labelledby={`history-day-${key}`}>
          <SectionLabel as="h3" labelId={`history-day-${key}`} count={events.length}>
            {dateTimeFormat(locale, {
              weekday: "long",
              day: "numeric",
              month: "long",
              // The current year is understood; older days name it.
              year:
                new Date(events[0].createdAt).getFullYear() === new Date().getFullYear()
                  ? undefined
                  : "numeric",
            }).format(new Date(events[0].createdAt))}
          </SectionLabel>
          <ol className={styles.events}>
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
                {/* The summary already says what happened; only problems earn a kind badge. */}
                {DANGER_KINDS.has(entry.kind) && (
                  <Badge size="xs" className={styles.kind} tone="danger">
                    {assistantActivityLabel(entry.kind)}
                  </Badge>
                )}
                {(entry.jobId || (entry.sessionId && onOpenSession)) && (
                  <div className={styles.actions}>
                    {entry.jobId && (
                      <InlineAction label={t("Job")} onClick={() => onJob(entry.jobId!)}>
                        <Briefcase className="icon-sm" />
                      </InlineAction>
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
