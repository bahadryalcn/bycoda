import { InlineError } from "../../../../shared/ui/InlineError";
import { ErrorDetails } from "../../../../shared/ui/ErrorDetails";
import { presentRemoteError } from "../../../connections/public/remoteFailure";
import { LoadingText } from "../../../../shared/ui/LoadingText";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { useEffect, useState } from "react";
import { formatDate, t } from "../../../../shared/i18n";
import { truncateGraphemes } from "../../../../shared/lib/text/truncate";
import { InlineMessage } from "../../../../shared/ui/InlineError";
import { ActivityRow, type ActivityKind } from "../common/ActivityRow";
import { TechnicalDetails } from "../common/TechnicalDetails";
import type { StatusTextStatus } from "../common/StatusText";
import { CollectionFooter } from "../../../../shared/ui/ContinuousList";
import type { AiAction } from "../../model/autonomy";
import type { SocialAccount, SocialJob } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import {
  appendUnique,
  mergeActivity,
  readActions,
  readJobs,
  type LoadedHistory,
} from "./activityHistoryModel";
import { useAccountWrite } from "./useAccountWrite";
import { useRequestToken } from "./useRequestToken";
import "./accounts.css";

export type ActivityHistoryProps = {
  client: SocialClient;
  accounts: SocialAccount[];
  projectId?: string;
};

function jobKindText(kind: SocialJob["kind"]): string {
  switch (kind) {
    case "publish":
      return t("Publishing");
    case "reply":
      return t("Replies");
    case "message":
      return t("Direct messages");
    case "comment":
      return t("Comments");
  }
}

/** Glyph kind for a job; comments have no dedicated glyph and fall back to "other". */
function jobActivityKind(kind: SocialJob["kind"]): ActivityKind {
  switch (kind) {
    case "publish":
      return "publish";
    case "reply":
      return "reply";
    case "message":
      return "message";
    case "comment":
      return "other";
  }
}

function reviewReasonText(reason: string | undefined): string {
  switch (reason) {
    case "awaiting_approval":
      return t("Waiting for your approval");
    case "retry_exhausted":
      return t("Stopped after repeated attempts");
    case "needs_human":
      return t("Waiting for you");
    default:
      return t("Needs review");
  }
}

function aiStatus(status: AiAction["status"]): StatusTextStatus {
  switch (status) {
    case "done":
      return "completed";
    case "queued":
      return "queued";
    case "failed":
      return "failed";
    case "blocked":
      return "review";
    case "undone":
      return "cancelled";
  }
}

/**
 * What was sent and what AI did, newest first. Jobs need owner review when the Host holds them;
 * AI actions can be undone only when the Host recorded an inverse.
 */
export function ActivityHistory({ client, accounts, projectId }: ActivityHistoryProps) {
  const [history, setHistory] = useState<LoadedHistory>({
    jobs: [],
    actions: [],
  });
  const [settled, setSettled] = useState<object>();
  const [loadProblem, setLoadProblem] = useState<{ title: string; details?: string }>();
  // Both are keyed by the request they belong to, so a reload or scope change drops them.
  const [moreLoading, setMoreLoading] = useState<object>();
  const [moreFailed, setMoreFailed] = useState<object>();
  const [attempt, setAttempt] = useState(0);
  const { failureTitle, details, write } = useAccountWrite(
    t("The action could not be undone. Try again."),
  );

  // A new request object marks every reload as pending until its read settles.
  const request = useRequestToken([attempt, client, projectId]);
  const loading = settled !== request;

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Reads the Host job and AI action history for this request; `alive` drops a read that settles after a reload or scope change.
  useEffect(() => {
    let alive = true;
    Promise.all([readJobs(client, projectId), readActions(client)])
      .then(
        ([jobPage, actionPage]) => {
          if (!alive) return;
          setHistory({
            request,
            jobs: jobPage.jobs,
            jobsNext: jobPage.next,
            actions: actionPage.items,
            actionsNext: actionPage.next,
          });
          setLoadProblem(undefined);
        },
        (reason) => {
          if (alive)
            setLoadProblem({
              title: t("The activity could not be read. Try again."),
              details: presentRemoteError(reason, { explicit: true }),
            });
        },
      )
      .finally(() => {
        if (alive) setSettled(request);
      });
    return () => {
      alive = false;
    };
  }, [request, client, projectId]);

  const reload = () => setAttempt((value) => value + 1);
  const loadMore = () => {
    if (history.request !== request || moreLoading === request) return;
    const { jobsNext, actionsNext } = history;
    setMoreLoading(request);
    setMoreFailed(undefined);
    Promise.all([
      jobsNext === undefined ? undefined : readJobs(client, projectId, jobsNext),
      actionsNext === undefined ? undefined : readActions(client, actionsNext),
    ])
      .then(
        ([jobPage, actionPage]) =>
          // A reload or scope change in the meantime replaced the history this page continues.
          setHistory((current) =>
            current.request === request
              ? {
                  request,
                  jobs: jobPage ? appendUnique(current.jobs, jobPage.jobs) : current.jobs,
                  jobsNext: jobPage ? jobPage.next : current.jobsNext,
                  actions: actionPage
                    ? appendUnique(current.actions, actionPage.items)
                    : current.actions,
                  actionsNext: actionPage ? actionPage.next : current.actionsNext,
                }
              : current,
          ),
        () => setMoreFailed(request),
      )
      .finally(() => setMoreLoading((current) => (current === request ? undefined : current)));
  };
  const { entries, held } = mergeActivity(
    history.jobs,
    history.actions,
    history.jobsNext !== undefined,
    history.actionsNext !== undefined,
  );
  const hasMore = history.jobsNext !== undefined || history.actionsNext !== undefined || held > 0;
  const nameOf = (accountId: string) =>
    accounts.find((account) => account.id === accountId)?.name ?? t("Removed account");

  return (
    <section
      {...surfaceAttributes({ frame: "pane", edge: "block-start" }, "social-card")}
      aria-label={t("Activity")}
    >
      {loadProblem ? (
        <InlineError
          details={loadProblem.details}
          retry={{ onRetry: reload, label: t("Try again") }}
        >
          {loadProblem.title}
        </InlineError>
      ) : failureTitle ? (
        <InlineError details={details}>{failureTitle}</InlineError>
      ) : null}
      {loading && !entries.length ? (
        <LoadingText delay={false} className="social-muted">
          {t("Loading…")}
        </LoadingText>
      ) : null}
      {!loading && !entries.length && !hasMore && !loadProblem ? (
        <EmptyState
          size="inline"
          kind="empty"
          className="social-muted"
          description={t("Nothing has been sent or changed yet.")}
        />
      ) : null}
      {entries.map((entry) => {
        if (entry.kind === "job") {
          const { job } = entry;
          return (
            <div key={`job:${job.id}`}>
              <ActivityRow
                title={`${jobKindText(job.kind)} · ${nameOf(job.accountId)}`}
                time={formatDate(job.createdAt, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
                status={job.status}
                kind={jobActivityKind(job.kind)}
                details={
                  <>
                    <p>{truncateGraphemes(job.payload.text, 160)}</p>
                    {job.status === "review" ? (
                      <InlineMessage tone="warning" live="off">
                        {reviewReasonText(job.reviewReason)}
                      </InlineMessage>
                    ) : null}
                    {job.error ? (
                      <ErrorDetails
                        detail={job.error}
                        title={`${jobKindText(job.kind)} · ${nameOf(job.accountId)}`}
                      />
                    ) : null}
                  </>
                }
              />
            </div>
          );
        }
        const { action } = entry;
        return (
          <ActivityRow
            key={`action:${action.id}`}
            title={action.summary}
            time={formatDate(action.at, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
            status={aiStatus(action.status)}
            kind="other"
            details={
              <>
                <TechnicalDetails>
                  <p>{action.action}</p>
                  {action.reason ? <p>{action.reason}</p> : null}
                </TechnicalDetails>
              </>
            }
            undo={
              action.undo
                ? {
                    onUndo: () =>
                      void write(`undo:${action.id}`, () => client.ai.undo(action.id))
                        .then((result) => result !== undefined && reload())
                        .catch(() => undefined),
                    ...(action.status === "undone"
                      ? { blockedReason: t("Already undone.") }
                      : action.status !== "done"
                        ? {
                            blockedReason: t("Only finished actions can be undone."),
                          }
                        : {}),
                  }
                : undefined
            }
          />
        );
      })}
      {history.request === request && hasMore ? (
        <CollectionFooter
          hasMore
          loading={moreLoading === request}
          error={moreFailed === request ? t("The activity could not be read. Try again.") : null}
          partial={t("More activity is available. Load more to include older entries.")}
          onLoadMore={loadMore}
          onRetry={loadMore}
        />
      ) : null}
    </section>
  );
}
