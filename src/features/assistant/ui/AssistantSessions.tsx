import type { AssistantJob } from "../../../shared/model/host-contracts/assistant";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Badge } from "../../../shared/ui/Badge";
import { Progress } from "../../../shared/ui/Progress";
import { ExternalLink } from "../../../shared/ui/icons";
import {
  workerContextAction,
  type WorkerContextSettings,
} from "../../../shared/model/assistantContext";
import { contextRatio, formatTokens } from "../../sessions/model/contextUsage";
import { useAssistantSession } from "../model/assistantSessions";
import { AssistantManagedBadge } from "../../sessions/ui/AssistantManagedBadge";
import styles from "./AssistantView.module.css";
import { assistantJobProjectIds } from "../model/assistantJobs";

export function AssistantSessions({
  jobs,
  contextSettings,
  query,
  filter,
  environmentId,
  projectName,
  onOpenSession,
}: {
  jobs: readonly AssistantJob[];
  contextSettings?: WorkerContextSettings;
  query: string;
  filter: string;
  environmentId?: string;
  projectName: (id: string) => string;
  onOpenSession?: (id: string, environmentId?: string) => void | Promise<void>;
}) {
  const entries = jobs
    .flatMap((job) => job.sessionIds.map((id) => ({ id, job })))
    .filter(
      ({ id, job }) =>
        (!filter || job.status === filter) &&
        (!query.trim() ||
          `${id}\n${job.title}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),
    );
  return (
    <section className={styles.section}>
      {entries.map(({ id, job }) => (
        <ManagedSessionRow
          key={`${job.id}:${id}`}
          id={id}
          job={job}
          contextSettings={contextSettings}
          projectName={projectName}
          environmentId={environmentId}
          onOpenSession={onOpenSession}
        />
      ))}
      {!entries.length && (
        <p className={styles.empty}>{t("No sessions from assistant jobs yet")}</p>
      )}
    </section>
  );
}

function ManagedSessionRow({
  id,
  job,
  contextSettings,
  projectName,
  environmentId,
  onOpenSession,
}: {
  id: string;
  job: AssistantJob;
  contextSettings?: WorkerContextSettings;
  projectName: (id: string) => string;
  environmentId?: string;
  onOpenSession?: (id: string, environmentId?: string) => void | Promise<void>;
}) {
  const { record, error, loading, refresh } = useAssistantSession(
    id,
    assistantJobProjectIds(job),
    environmentId,
  );
  const current = error ? null : record;
  const project = current
    ? projectName(current.projectId)
    : assistantJobProjectIds(job).map(projectName).join(" · ");
  const usage = current?.session.context;
  const used = usage && Number.isFinite(usage.used) && usage.used >= 0 ? usage.used : undefined;
  const window =
    usage?.window && Number.isFinite(usage.window) && usage.window > 0 ? usage.window : undefined;
  const ratio = used === undefined ? null : contextRatio({ used, window });
  const action = workerContextAction(used, window, contextSettings);
  const status = current?.status;
  return (
    <div className={styles.row} data-assistant-session={id}>
      <div className={styles.rowText}>
        <strong>{record?.session.title || id}</strong>
        <p>
          {job.title} · {project}
        </p>
        <div className={styles.contextMeter}>
          {ratio !== null && used !== undefined && window !== undefined ? (
            <Progress
              label={t("Context usage")}
              value={ratio * 100}
              max={100}
              compact
              showValue
              valueLabel={`${formatTokens(used)} / ${formatTokens(window)}`}
              tone={action === "handoff" ? "danger" : action === "compact" ? "warning" : "neutral"}
            />
          ) : (
            <span className={styles.muted}>
              {used === undefined
                ? t("Context usage unavailable")
                : t("{p0} tokens · Context window unknown", {
                    p0: formatTokens(used),
                  })}
            </span>
          )}
          {current && (
            <span className={styles.muted}>
              {t(
                action === "handoff"
                  ? "Handoff required before the next message"
                  : action === "compact"
                    ? "Compaction required before the next message"
                    : "Context ready",
              )}
            </span>
          )}
        </div>
        {current && (
          <span className={styles.muted}>
            {t("Last activity: {p0}", {
              p0: new Date(current.updatedAt).toLocaleString(),
            })}
          </span>
        )}
        {error && (
          <div role="alert" className={styles.feedback}>
            <span>{t(error)}</span>
            <Button loading={loading} onClick={() => void refresh()}>
              {t("Retry")}
            </Button>
          </div>
        )}
      </div>
      <AssistantManagedBadge management={current?.session.managedBy} compact />
      <Badge
        tone={status === "interrupted" ? "warning" : status === "running" ? "info" : "neutral"}
      >
        {t(
          status === "running"
            ? "Running"
            : status === "interrupted"
              ? "Interrupted"
              : status === "idle"
                ? "Idle"
                : loading
                  ? "Loading..."
                  : "Unknown",
        )}
      </Badge>
      {onOpenSession && (
        <Button
          iconOnly
          label={t("Open session")}
          onClick={() => {
            const expected = record?.environmentId ?? environmentId;
            return expected ? onOpenSession(id, expected) : onOpenSession(id);
          }}
        >
          <ExternalLink className="icon-sm" />
        </Button>
      )}
    </div>
  );
}
