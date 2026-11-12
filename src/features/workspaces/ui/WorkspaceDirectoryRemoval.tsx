import { Text } from "../../../shared/ui/Text";
import { useEffect, useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { projectName } from "../../../shared/lib/paths";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import type { ManagedWorkspace, WorkspaceCleanupPlan } from "../model/contracts";
import { runBackgroundRemoval } from "../model/backgroundRemoval";
import {
  workspaceOperationKey,
  workspaceRequest,
  type WorkspaceContext,
} from "../model/workspaceClient";

/**
 * Previews and confirms removal of a managed directory. After confirmation the dialog closes and
 * the Host removal continues in the background; a toast reports its result.
 */
export function WorkspaceDirectoryRemoval({
  workspace,
  context,
  closeFirst = false,
  missing = false,
  onClose,
  onWorkspaceChange,
}: {
  workspace: ManagedWorkspace;
  context: WorkspaceContext;
  /** The folder is gone but the record is still active: close the workspace before retiring it. */
  closeFirst?: boolean;
  /** The folder is not on disk, so removal only retires the record. */
  missing?: boolean;
  onClose: () => void;
  onWorkspaceChange?: (workspace: ManagedWorkspace) => void;
}) {
  const t = useT();
  const [plan, setPlan] = useState<WorkspaceCleanupPlan | null>(null);
  const [pending, setPending] = useState<"plan" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const latest = async () => {
    const fresh = await workspaceRequest("workspaces.get", { workspaceId: workspace.id }, context);
    if (!fresh) throw new Error(t("This workspace is no longer available."));
    return fresh;
  };
  const planFor = (fresh: ManagedWorkspace) =>
    workspaceRequest(
      "workspaces.cleanup.plan",
      { workspaceId: fresh.id, expectedRevision: fresh.revision },
      context,
    );
  async function preview() {
    if (lock.current) return;
    lock.current = true;
    setPending("plan");
    setError(null);
    setPlan(null);
    try {
      setPlan(await planFor(await latest()));
      setNow(Date.now());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      lock.current = false;
      setPending(null);
    }
  }
  useEffect(() => {
    // An active record cannot be previewed for removal until the owner confirms closing it.
    if (!closeFirst) void preview();
  }, [workspace.id]);
  /** Closes the dialog at once; closing, planning and deleting continue in the background. */
  function remove() {
    if (lock.current) return;
    if (!closeFirst && (!plan || plan.expiresAt <= Date.now() || plan.blockers.length)) return;
    const approved = plan;
    onClose();
    void runBackgroundRemoval(workspace.path, projectName(workspace.path), async () => {
      let confirmed = approved;
      if (closeFirst) {
        const fresh = await latest();
        const closed = await workspaceRequest(
          "workspaces.close",
          {
            workspaceId: fresh.id,
            expectedRevision: fresh.revision,
            idempotencyKey: workspaceOperationKey(),
          },
          context,
        ).catch(async (reason: unknown) => {
          // An unconfirmed close is settled by the Host's record, never by a blind retry.
          const current = await latest().catch(() => null);
          if (current?.state === "abandoned") return current;
          throw reason;
        });
        onWorkspaceChange?.(closed);
        if (closed.directoryState === "removed") return;
        confirmed = await planFor(closed);
        if (confirmed.blockers.length) throw new Error(confirmed.blockers.join("; "));
      }
      if (!confirmed) return;
      let failure: unknown;
      await workspaceRequest(
        "workspaces.cleanup.apply",
        {
          workspaceId: workspace.id,
          expectedRevision: confirmed.expectedRevision,
          idempotencyKey: workspaceOperationKey(),
          planToken: confirmed.token,
        },
        context,
      ).catch((reason: unknown) => {
        failure = reason;
      });
      // An unconfirmed apply is settled by the Host's status, never by a blind retry.
      const status = await workspaceRequest(
        "workspaces.cleanup.status",
        { workspaceId: workspace.id },
        context,
      ).catch(() => null);
      if (status) onWorkspaceChange?.(status.workspace);
      if (status?.workspace.directoryState === "removed") return;
      throw failure instanceof Error
        ? failure
        : new Error(t("Directory removal is not complete. Open its removal again to check it."));
    });
  }
  const missingRecord = missing || closeFirst;
  return (
    <Modal
      title={missingRecord ? t("Remove workspace record") : t("Delete worktree directory")}
      onClose={() => {
        if (!lock.current) onClose();
      }}
      footer={
        <ModalActions>
          <Button variant="secondary" disabled={!!pending} onClick={onClose}>
            {t("Cancel")}
          </Button>
          {!closeFirst && (
            <Button
              variant="secondary"
              loading={pending === "plan"}
              disabled={!!pending && pending !== "plan"}
              onClick={() => void preview()}
            >
              {t("Refresh preview")}
            </Button>
          )}
          <Button
            variant="primary"
            tone="danger"
            disabled={
              !!pending ||
              (!closeFirst && (!plan || !!plan.blockers.length || plan.expiresAt <= now))
            }
            onClick={remove}
          >
            {missingRecord ? t("Remove record") : t("Delete directory")}
          </Button>
        </ModalActions>
      }
    >
      <Text as="div" size="body" tone="inherit" className="space-y-3">
        <p>
          {closeFirst && workspace.state === "active"
            ? t(
                "The folder is gone but this workspace is still marked active. Removing the record closes the workspace first; the conversation and branch are kept.",
              )
            : t(
                "The conversation, branch and recovery history are retained. Resume recreates the directory.",
              )}
        </p>
        <Text as="p" size="inherit" tone="secondary" className="break-all font-mono">
          {plan?.path ?? workspace.path}
        </Text>
        {pending === "plan" && <LoadingText>{t("Checking directory…")}</LoadingText>}
        {error && <InlineError className="break-words">{error}</InlineError>}
        {plan && (
          <>
            {plan.head && (
              <p className="break-all">
                {plan.branchRef} · {plan.head.slice(0, 12)}
              </p>
            )}
            {plan.dirty && (
              <InlineMessage tone="warning">
                {t("Uncommitted work must be preserved by the host before removal.")}
              </InlineMessage>
            )}
            {!!plan.links.length && (
              <p>{t("Dependency links are detached without deleting their targets.")}</p>
            )}
            {plan.blockers.length > 0 && (
              <Alert tone="danger" title={t("Cleanup blocked")}>
                <ul className="list-inside list-disc">
                  {plan.blockers.map((reason) => (
                    <li key={reason} className="break-words">
                      {reason}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
            {plan.expiresAt <= now && (
              <InlineError>
                {t("This preview expired. Refresh preview before deleting.")}
              </InlineError>
            )}
          </>
        )}
      </Text>
    </Modal>
  );
}
