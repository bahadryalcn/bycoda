import type { AssistantJob } from "../../../shared/model/host-contracts/assistant";
import { formatNumber, t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Badge } from "../../../shared/ui/Badge";
import { ActionHost, InlineAction } from "../../../shared/ui/ActionHost";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { InlineError } from "../../../shared/ui/InlineError";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Skeleton } from "../../../shared/ui/Skeleton";
import { Meter, type MeterTone } from "../../../shared/ui/Meter";
import { Timestamp } from "../../../shared/ui/Timestamp";
import { WorkingIndicator } from "../../../shared/ui/WorkingIndicator";
import { ExternalLink, MessageSquare } from "../../../shared/ui/icons";
import {
  workerContextAction,
  type WorkerContextSettings,
} from "../../../shared/model/assistantContext";
import { contextPercent, formatTokens } from "../../sessions/model/contextUsage";
import { useAssistantSession } from "../model/assistantSessions";
import { AssistantManagedBadge } from "../../sessions/ui/AssistantManagedBadge";
import { HarnessIcon } from "../../sessions/public/HarnessIcon";
import { useModelSource } from "../../sessions/public/modelSource";
import styles from "./AssistantView.module.css";
import sessionStyles from "./AssistantSessions.module.css";
import { assistantJobProjectIds } from "../model/assistantJobs";

export function AssistantSessions({
  jobs,
  contextSettings,
  query,
  filter,
  environmentId,
  projectName,
  onOpenSession,
  onJobs,
  onReset,
}: {
  jobs: readonly AssistantJob[];
  contextSettings?: WorkerContextSettings;
  query: string;
  filter: string;
  environmentId?: string;
  projectName: (id: string) => string;
  onOpenSession?: (id: string, environmentId?: string) => void | Promise<void>;
  onJobs?: () => void;
  onReset?: () => void;
}) {
  const entries = jobs
    .flatMap((job) => job.sessionIds.map((id) => ({ id, job })))
    .filter(
      ({ id, job }) =>
        (!filter || job.status === filter) &&
        (!query.trim() ||
          `${id}\n${job.title}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),
    );
  const groups: { job: AssistantJob; ids: string[] }[] = [];
  for (const { id, job } of entries) {
    const group = groups.find((value) => value.job.id === job.id);
    if (group) group.ids.push(id);
    else groups.push({ job, ids: [id] });
  }
  const filtered = Boolean(query.trim() || filter);
  return (
    <section className={sessionStyles.panel} aria-label={t("Job sessions")}>
      <SectionLabel as="h2" count={entries.length}>
        {t("Job sessions")}
      </SectionLabel>
      {groups.map(({ job, ids }) => (
        <div
          key={job.id}
          className={sessionStyles.group}
          role="group"
          aria-label={job.title}
          data-assistant-session-group={job.id}
        >
          <div className={sessionStyles.groupHead}>
            <span className={sessionStyles.groupTitle}>{job.title}</span>
            <Badge size="sm">{assistantJobProjectIds(job).map(projectName).join(" · ")}</Badge>
          </div>
          {ids.map((id) => (
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
        </div>
      ))}
      {!entries.length && (
        <EmptyState
          context="panel"
          kind={filtered ? "filtered" : "empty"}
          icon={filtered ? undefined : <MessageSquare className="icon-md" aria-hidden="true" />}
          title={t(filtered ? "No matching sessions" : "No sessions from assistant jobs yet")}
          description={t(
            filtered
              ? "Try a different search or clear the filters."
              : "Sessions that assistant jobs start appear here with their context usage.",
          )}
          resetLabel={t("Clear filters")}
          onReset={filtered ? onReset : undefined}
          action={
            !filtered && onJobs ? <Button onClick={onJobs}>{t("View jobs")}</Button> : undefined
          }
        />
      )}
    </section>
  );
}

/**
 * One job session in fixed columns: name and provider, job · project, last activity, context meter with its
 * reason, status and the open action. Unknown usage shows an empty track and its text, never "Context ready".
 */
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
  const source = useModelSource();
  const current = error ? null : record;
  const project = current
    ? projectName(current.projectId)
    : assistantJobProjectIds(job).map(projectName).join(" · ");
  const usage = current?.session.context;
  const used = usage && Number.isFinite(usage.used) && usage.used >= 0 ? usage.used : undefined;
  const window =
    usage?.window && Number.isFinite(usage.window) && usage.window > 0 ? usage.window : undefined;
  const percent = used === undefined ? null : contextPercent({ used, window });
  const action = workerContextAction(used, window, contextSettings);
  const tone: MeterTone =
    action === "handoff" ? "danger" : action === "compact" ? "warning" : "neutral";
  const reason =
    action === "handoff"
      ? t("Handoff required before the next message")
      : action === "compact"
        ? t("Compaction required before the next message")
        : t("Context ready");
  const initialLoad = loading && !record && !error;
  const status = current?.status;
  const sessionModel = current?.session;
  const model = sessionModel?.harness
    ? source.resolve(sessionModel.harness, sessionModel.model)
    : null;
  const statusLabel =
    status === "running"
      ? t("Running")
      : status === "interrupted"
        ? t("Interrupted")
        : status === "idle"
          ? t("Idle")
          : loading
            ? t("Loading...")
            : t("Unknown");
  return (
    <ActionHost className={sessionStyles.jobRow} data-assistant-session={id}>
      <div className={sessionStyles.jobText}>
        {initialLoad ? (
          <Skeleton lines={2} label={t("Loading session")} className={sessionStyles.skeleton} />
        ) : (
          <>
            <span className={sessionStyles.titleLine}>
              <strong>{record?.session.title || id}</strong>
              {model && (
                <span className={sessionStyles.model} data-session-model>
                  <HarnessIcon harness={model.harness} size="xs" />
                  <span className={sessionStyles.modelName}>{model.name}</span>
                </span>
              )}
            </span>
            {!current && <p className={sessionStyles.caption}>{project}</p>}
          </>
        )}
        {current && (
          <span className={sessionStyles.muted}>
            {t("Last activity")} <Timestamp value={current.updatedAt} />
          </span>
        )}
        {error && (
          <InlineError
            className={styles.feedback}
            retry={{ onRetry: () => void refresh(), pending: loading }}
          >
            {t(error)}
          </InlineError>
        )}
      </div>
      <div className={sessionStyles.jobMeter}>
        {initialLoad ? (
          <Skeleton
            lines={2}
            label={t("Loading context usage")}
            className={sessionStyles.skeleton}
          />
        ) : (
          <>
            <div className={sessionStyles.meterHead}>
              <span>{t("Context usage")}</span>
              {percent !== null && (
                <span className={sessionStyles.percent} data-tone={tone}>
                  {formatNumber(percent / 100, { style: "percent" })}
                </span>
              )}
            </div>
            <Meter
              label={t("Context usage")}
              value={percent}
              tone={tone}
              valueText={
                used !== undefined && window !== undefined
                  ? `${formatTokens(used)} / ${formatTokens(window)}`
                  : undefined
              }
            />
            {percent === null && (
              <span className={sessionStyles.muted}>
                {used === undefined
                  ? t("Context usage unavailable")
                  : t("{p0} tokens · Context window unknown", { p0: formatTokens(used) })}
              </span>
            )}
            {percent !== null && current && <span className={sessionStyles.muted}>{reason}</span>}
          </>
        )}
      </div>
      <div className={sessionStyles.jobStatus}>
        <AssistantManagedBadge management={current?.session.managedBy} compact />
        <Badge
          size="sm"
          tone={status === "interrupted" ? "warning" : status === "running" ? "info" : "neutral"}
        >
          {status === "running" && <WorkingIndicator className={sessionStyles.indicator} />}
          {statusLabel}
        </Badge>
      </div>
      {onOpenSession && (
        <InlineAction
          label={t("Open session")}
          onClick={() => {
            const expected = record?.environmentId ?? environmentId;
            return expected ? onOpenSession(id, expected) : onOpenSession(id);
          }}
        >
          <ExternalLink className="icon-sm" aria-hidden="true" />
        </InlineAction>
      )}
    </ActionHost>
  );
}
