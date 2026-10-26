import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Modal } from "../../../shared/ui/Modal";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { parseRemotePath, remotePath } from "../../connections/model/remoteProjects";
import type {
  BranchDeliveryPlan,
  BranchPublicationReceipt,
  ManagedWorkspace,
} from "../model/contracts";
import {
  getWorkspaceCapabilities,
  workspaceOperationKey,
  workspaceRequest,
  type WorkspaceContext,
} from "../model/workspaceClient";

const CommitDiff = lazy(() =>
  import("../../source-control/ui/CommitDiff").then((module) => ({ default: module.CommitDiff })),
);
const branchName = (ref: string) => ref.replace(/^refs\/heads\//, "");
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
type PublicationDraft = Extract<BranchDeliveryPlan, { action: "publish" }>["publication"];
type PublicationAttempt = { plan: Extract<BranchDeliveryPlan, { action: "publish" }>; key: string };
const publicationStorageKey = (workspace: ManagedWorkspace, kind: string) =>
  `bycoda.workspace-publication.${kind}.${workspace.environmentId}.${workspace.id}`;
function savedPublication<T>(workspace: ManagedWorkspace, kind: string): T | null {
  try {
    const raw = localStorage.getItem(publicationStorageKey(workspace, kind));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function savePublication(workspace: ManagedWorkspace, kind: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(publicationStorageKey(workspace, kind));
    else localStorage.setItem(publicationStorageKey(workspace, kind), JSON.stringify(value));
  } catch {
    /* An unavailable preference store must not discard the in-memory intent. */
  }
}

export function WorkspaceReview({
  workspace,
  context,
  onClose,
  onWorkspaceChange,
}: {
  workspace: ManagedWorkspace;
  context: WorkspaceContext;
  onClose: () => void;
  onWorkspaceChange?: (workspace: ManagedWorkspace) => void;
}) {
  const t = useT();
  const [plan, setPlan] = useState<BranchDeliveryPlan | null>(null);
  const [mode, setMode] = useState<"merge" | "publish">(() =>
    savedPublication(workspace, "attempt") ? "publish" : "merge",
  );
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [publication, setPublication] = useState<PublicationDraft>(
    () =>
      savedPublication<PublicationDraft>(workspace, "draft") ?? {
        repository: "",
        remote: "origin",
        baseBranchRef: workspace.targetBranchRef,
        headBranchRef: workspace.branchRef,
        title: "",
        body: "",
      },
  );
  const [receipt, setReceipt] = useState<BranchPublicationReceipt | null>(null);
  const [diffCommit, setDiffCommit] = useState<string | null>(null);
  const lock = useRef(false);
  const publicationAttempt = useRef<PublicationAttempt | null>(
    savedPublication<PublicationAttempt>(workspace, "attempt"),
  );
  useEffect(() => {
    savePublication(workspace, "draft", publication);
  }, [workspace.id, workspace.environmentId, publication]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let live = true;
    void getWorkspaceCapabilities(context)
      .then((value) => {
        if (live) setCapabilities(value);
      })
      .catch((reason) => {
        if (live) setError(errorText(reason));
      });
    return () => {
      live = false;
    };
  }, [context.cwd, context.environmentId]);

  async function review(action: "merge" | "publish") {
    if (lock.current) return;
    lock.current = true;
    setPending("review");
    setError(null);
    setMessage(null);
    setPlan(null);
    try {
      const fresh = await workspaceRequest(
        "workspaces.get",
        { workspaceId: workspace.id },
        context,
      );
      if (!fresh) throw new Error(t("This workspace is no longer available."));
      const result = await workspaceRequest(
        "workspaces.delivery.review",
        {
          workspaceId: fresh.id,
          expectedRevision: fresh.revision,
          action,
          ...(action === "publish" ? { publication } : {}),
        } as Parameters<typeof workspaceRequest<"workspaces.delivery.review">>[1],
        context,
      );
      setPlan(result);
      setNow(Date.now());
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      lock.current = false;
      setPending(null);
    }
  }
  useEffect(() => {
    if (!publicationAttempt.current) void review("merge");
  }, [workspace.id]);

  async function deliver() {
    if (
      !plan ||
      lock.current ||
      plan.expiresAt <= Date.now() ||
      plan.blockers.length ||
      plan.overlappingPaths.length
    )
      return;
    lock.current = true;
    setPending(plan.action);
    setError(null);
    const attempt = { plan, key: workspaceOperationKey() };
    if (plan.action === "publish") {
      publicationAttempt.current = { plan, key: attempt.key };
      savePublication(workspace, "attempt", publicationAttempt.current);
    }
    try {
      await apply(attempt);
    } catch (reason) {
      // Keep the original token and operation key for publication reconciliation.
      // A lost response must never generate a second push or PR intent.
      setError(errorText(reason));
      if (plan.action === "merge") setPlan(null);
    } finally {
      lock.current = false;
      setPending(null);
    }
  }
  async function apply(attempt: { plan: BranchDeliveryPlan; key: string }) {
    const params = {
      workspaceId: workspace.id,
      expectedRevision: attempt.plan.expectedRevision,
      idempotencyKey: attempt.key,
      planToken: attempt.plan.token,
    };
    if (attempt.plan.action === "merge") {
      await workspaceRequest("workspaces.delivery.merge", params, context);
      setMessage(t("Merged into {p0}.", { p0: branchName(attempt.plan.targetBranchRef) }));
      setPlan(null);
    } else {
      const result = await workspaceRequest("workspaces.delivery.publish", params, context);
      setReceipt(result);
      if (result.status === "complete") {
        publicationAttempt.current = null;
        savePublication(workspace, "attempt", null);
        setPlan(null);
        setMessage(t("Pull request created."));
      } else
        setMessage(
          t(
            "Publication is incomplete. Check the recorded push and pull request before continuing.",
          ),
        );
    }
    const fresh = await workspaceRequest("workspaces.get", { workspaceId: workspace.id }, context);
    if (fresh) onWorkspaceChange?.(fresh);
  }
  async function reconcilePublication() {
    if (!publicationAttempt.current || lock.current) return;
    lock.current = true;
    setPending("publish");
    setError(null);
    try {
      await apply(publicationAttempt.current);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      lock.current = false;
      setPending(null);
    }
  }
  const expired = !!plan && plan.expiresAt <= now;
  const attempted = !!publicationAttempt.current;
  const executionCwd =
    context.cwd && parseRemotePath(context.cwd)
      ? remotePath(workspace.environmentId, workspace.path)
      : workspace.path;
  return (
    <Modal
      title={t(mode === "publish" ? "Create PR" : "Review changes")}
      size="lg"
      onClose={() => {
        if (!lock.current) onClose();
      }}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="secondary" disabled={!!pending} onClick={onClose}>
            {t("Close")}
          </Button>
          {attempted ? (
            <Button loading={pending === "publish"} onClick={() => void reconcilePublication()}>
              {t("Check publication status")}
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                loading={pending === "review"}
                disabled={!!pending && pending !== "review"}
                onClick={() => void review(mode)}
              >
                {t(plan ? "Refresh review" : "Retry review")}
              </Button>
              {plan && (
                <Button
                  loading={pending === mode}
                  disabled={
                    !!pending || expired || !!plan.blockers.length || !!plan.overlappingPaths.length
                  }
                  onClick={() => void deliver()}
                >
                  {mode === "publish"
                    ? t("Push branch and create PR")
                    : t("Merge into {p0}", { p0: branchName(plan.targetBranchRef) })}
                </Button>
              )}
            </>
          )}
        </div>
      }
    >
      <div className="space-y-4 p-4 text-ui-body">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 break-all text-(--ui-text-secondary)">
            {branchName(workspace.branchRef)} → {branchName(workspace.targetBranchRef)}
          </p>
          {mode === "merge" && (
            <Button
              variant="secondary"
              disabled={!!pending || !capabilities.includes("workspaces.pr-publication.v1")}
              onClick={() => {
                setMode("publish");
                setPlan(null);
                setError(null);
              }}
            >
              {t("Create PR")}
            </Button>
          )}
          {mode === "publish" && !attempted && (
            <Button
              variant="ghost"
              disabled={!!pending}
              onClick={() => {
                setMode("merge");
                void review("merge");
              }}
            >
              {t("Back to review")}
            </Button>
          )}
        </div>
        {mode === "publish" && (
          <>
            <p className="text-(--ui-text-secondary)">
              {t(
                "This action pushes the reviewed branch and creates a pull request. Both steps require your approval.",
              )}
            </p>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-3">
              {(
                [
                  ["repository", "Repository"],
                  ["remote", "Remote"],
                  ["baseBranchRef", "Base branch"],
                  ["headBranchRef", "Head branch"],
                  ["title", "Title"],
                ] as const
              ).map(([key, label]) => (
                <TextField
                  key={key}
                  label={t(label)}
                  value={publication[key]}
                  disabled={!!pending || attempted}
                  onChange={(event) => {
                    setPublication((value) => ({ ...value, [key]: event.target.value }));
                    setPlan(null);
                  }}
                />
              ))}
            </div>
            <TextareaField
              label={t("Description")}
              rows={4}
              value={publication.body}
              disabled={!!pending || attempted}
              onChange={(event) => {
                setPublication((value) => ({ ...value, body: event.target.value }));
                setPlan(null);
              }}
            />
            <Button
              variant="secondary"
              disabled={
                !!pending ||
                attempted ||
                !publication.repository.trim() ||
                !publication.title.trim()
              }
              loading={pending === "review"}
              onClick={() => void review("publish")}
            >
              {t("Review publication")}
            </Button>
          </>
        )}
        {pending === "review" && <p role="status">{t("Preparing review…")}</p>}
        {error && (
          <p role="alert" className="break-words text-(--ui-tone-danger-fg)">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        {receipt && (
          <dl className="space-y-1">
            <div>
              <dt className="inline text-(--ui-text-secondary)">{t("Branch push")}: </dt>
              <dd className="inline">
                {receipt.push
                  ? `${receipt.push.remote} · ${receipt.push.sourceHead.slice(0, 12)}`
                  : t("Not confirmed")}
              </dd>
            </div>
            <div>
              <dt className="inline text-(--ui-text-secondary)">{t("Pull request")}: </dt>
              <dd className="inline">
                {receipt.pullRequest ? (
                  <a href={receipt.pullRequest.url} target="_blank" rel="noreferrer">
                    #{receipt.pullRequest.number}
                  </a>
                ) : (
                  t("Not confirmed")
                )}
              </dd>
            </div>
          </dl>
        )}
        {plan && (
          <>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
              <dt>{t("Source SHA")}</dt>
              <dd className="break-all font-mono">{plan.sourceHead}</dd>
              <dt>{t("Target SHA")}</dt>
              <dd className="break-all font-mono">{plan.targetHead}</dd>
              <dt>{t("Workspace revision")}</dt>
              <dd>{plan.expectedRevision}</dd>
            </dl>
            <p className="break-all text-ui-caption text-(--ui-text-secondary)">
              {t("Target status fingerprint")}: {plan.targetStatusFingerprint}
            </p>
            <p className="text-(--ui-text-secondary)">
              {t("Approval applies only to these revisions. Changes require a fresh review.")}
            </p>
            {expired && (
              <p role="alert" className="text-(--ui-tone-warning-fg)">
                {t("This review expired. Refresh review before approving.")}
              </p>
            )}
            {!!plan.blockers.length && (
              <div role="alert">
                <h3 className="font-medium">{t("Delivery blocked")}</h3>
                <ul className="list-inside list-disc">
                  {plan.blockers.map((blocker) => (
                    <li key={blocker} className="break-words">
                      {blocker}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!!plan.overlappingPaths.length && (
              <div role="alert">
                <h3 className="font-medium">{t("Overlapping target changes")}</h3>
                <ul>
                  {plan.overlappingPaths.map((path) => (
                    <li key={path} className="break-all">
                      {path}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-4">
              <section>
                <h3 className="font-medium">
                  {t("Commits")} ({plan.commits.length})
                </h3>
                <ul>
                  {plan.commits.map((sha) => (
                    <li key={sha}>
                      <Button
                        variant="ghost"
                        className="max-w-full"
                        title={sha}
                        onClick={() => setDiffCommit((value) => (value === sha ? null : sha))}
                      >
                        {sha.slice(0, 12)}
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <h3 className="font-medium">
                  {t("Changed files")} ({plan.changedPaths.length})
                </h3>
                <ul>
                  {plan.changedPaths.map((path) => (
                    <li key={path} className="break-all text-(--ui-text-secondary)">
                      {path}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
            {diffCommit && (
              <section className="min-w-0 overflow-hidden">
                <h3 className="font-medium">
                  {t("Commit diff")} · {diffCommit.slice(0, 12)}
                </h3>
                <Suspense fallback={<p role="status">{t("Loading diff…")}</p>}>
                  <CommitDiff cwd={executionCwd} sha={diffCommit} />
                </Suspense>
              </section>
            )}
            <section>
              <h3 className="font-medium">{t("Checks")}</h3>
              {plan.checks.length ? (
                <ul>
                  {plan.checks.map((check) => (
                    <li key={check.name} className="break-words">
                      {check.name}: {t(check.status)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-(--ui-text-secondary)">{t("No check results recorded.")}</p>
              )}
            </section>
            <section>
              <h3 className="font-medium">{t("Visual evidence")}</h3>
              {plan.visualEvidence.length ? (
                <ul>
                  {plan.visualEvidence.map((evidence) => (
                    <li key={evidence} className="break-all text-(--ui-text-secondary)">
                      {evidence}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-(--ui-text-secondary)">{t("No visual evidence recorded.")}</p>
              )}
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}
