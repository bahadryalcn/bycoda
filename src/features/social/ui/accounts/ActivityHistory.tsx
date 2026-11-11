import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDate, t } from "../../../../shared/i18n";
import { truncateGraphemes } from "../../../../shared/lib/text/truncate";
import { Heading } from "../../../../shared/ui/Heading";
import { InlineMessage } from "../../../../shared/ui/InlineError";
import { ActivityRow } from "../common/ActivityRow";
import { TechnicalDetails } from "../common/TechnicalDetails";
import type { StatusTextStatus } from "../common/StatusText";
import type { AiAction } from "../../model/autonomy";
import type { SocialAccount, SocialJob } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { useAccountWrite } from "./useAccountWrite";
import "./accounts.css";

export type ActivityHistoryProps = {
  client: SocialClient;
  accounts: SocialAccount[];
  projectId?: string;
};

const JOB_LIMIT = 20;

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
      return "succeeded";
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
  const [jobs, setJobs] = useState<SocialJob[]>([]);
  const [actions, setActions] = useState<AiAction[]>([]);
  const [settled, setSettled] = useState<object>();
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const { error, write } = useAccountWrite(t("The action could not be undone. Try again."));

  // A new request object marks every reload as pending until its read settles.
  const request = useMemo(() => ({}), [attempt, client, projectId]);
  const loading = settled !== request;

  useEffect(() => {
    let alive = true;
    Promise.all([
      client.sectionSnapshot({
        section: "history",
        limit: JOB_LIMIT,
        ...(projectId ? { projectId } : {}),
      }),
      client.ai.actions({}),
    ])
      .then(
        ([response, page]) => {
          if (!alive) return;
          setJobs((response.snapshot?.jobs ?? []).slice(0, JOB_LIMIT));
          setActions(page.items);
          setLoadError("");
        },
        () => {
          if (alive) setLoadError(t("The activity could not be read. Try again."));
        },
      )
      .finally(() => {
        if (alive) setSettled(request);
      });
    return () => {
      alive = false;
    };
  }, [request, client, projectId]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  const nameOf = (accountId: string) =>
    accounts.find((account) => account.id === accountId)?.name ?? "";

  return (
    <section className="social-card" aria-label={t("Activity")}>
      <Heading size="item">{t("Activity")}</Heading>
      {loadError ? (
        <InlineMessage tone="danger" retry={{ onRetry: reload, label: t("Try again") }}>
          {loadError}
        </InlineMessage>
      ) : null}
      {error ? <InlineMessage tone="danger">{error}</InlineMessage> : null}
      {loading && !jobs.length && !actions.length ? (
        <p className="social-muted">{t("Loading…")}</p>
      ) : null}
      {!loading && !jobs.length && !actions.length && !loadError ? (
        <p className="social-muted">{t("Nothing has been sent or changed yet.")}</p>
      ) : null}
      {jobs.map((job) => (
        <div key={job.id}>
          <ActivityRow
            title={`${jobKindText(job.kind)} · ${nameOf(job.accountId)}`}
            time={formatDate(job.createdAt, { dateStyle: "medium", timeStyle: "short" })}
            status={job.status}
            details={
              <>
                <p>{truncateGraphemes(job.payload.text, 160)}</p>
                {job.error ? (
                  <TechnicalDetails>
                    <p>{job.error}</p>
                  </TechnicalDetails>
                ) : null}
              </>
            }
          />
          {job.status === "review" ? (
            <InlineMessage tone="warning" live="off" className="social-history-held-reason">
              {reviewReasonText(job.reviewReason)}
            </InlineMessage>
          ) : null}
        </div>
      ))}
      {actions.map((action) => (
        <ActivityRow
          key={action.id}
          title={action.summary}
          time={formatDate(action.at, { dateStyle: "medium", timeStyle: "short" })}
          status={aiStatus(action.status)}
          details={
            <>
              {action.undo ? null : <p>{t("This action cannot be undone.")}</p>}
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
                      ? { blockedReason: t("Only finished actions can be undone.") }
                      : {}),
                }
              : undefined
          }
        />
      ))}
    </section>
  );
}
