import type { AssistantActivity } from "../../../shared/model/host-contracts/assistant";
import { t, useLocale } from "../../../shared/i18n";
import { isoTimestamp } from "../../../shared/lib/time/timestamps";
import { Button } from "../../../shared/ui/Button";
import { ExternalLink } from "../../../shared/ui/icons";
import styles from "./AssistantHistory.module.css";

const labels: Record<string, string> = {
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
};

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
      {!entries.length && (
        <p className={styles.empty} role="status">
          {t(filtered ? "No results" : "No activity yet")}
        </p>
      )}
      {[...groups].map(([key, events]) => (
        <section className={styles.day} key={key}>
          <h3>
            {new Date(events[0].createdAt).toLocaleDateString(locale, {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </h3>
          <ol className={styles.events}>
            {events.map((entry) => (
              <li className={styles.event} key={entry.id}>
                <time className={styles.time} dateTime={isoTimestamp(entry.createdAt)}>
                  {new Date(entry.createdAt).toLocaleTimeString(locale, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
                <div className={styles.body}>
                  <p>{entry.summary}</p>
                  <span className={styles.kind}>{t(labels[entry.kind] ?? "Activity")}</span>
                </div>
                {(entry.jobId || (entry.sessionId && onOpenSession)) && (
                  <div className={styles.actions}>
                    {entry.jobId && (
                      <Button variant="ghost" onClick={() => onJob(entry.jobId!)}>
                        {t("Job")}
                      </Button>
                    )}
                    {entry.sessionId && onOpenSession && (
                      <Button
                        iconOnly
                        label={t("Open session")}
                        onClick={() => onOpenSession(entry.sessionId!)}
                      >
                        <ExternalLink className="icon-sm" />
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
