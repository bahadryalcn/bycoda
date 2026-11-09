import { useEffect, useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import type { ManagedWorkspace, WorkspaceCleanupPlan } from "../model/contracts";
import {
  workspaceOperationKey,
  workspaceRequest,
  type WorkspaceContext,
} from "../model/workspaceClient";

export function WorkspaceDirectoryRemoval({
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
  const [plan, setPlan] = useState<WorkspaceCleanupPlan | null>(null);
  const [pending, setPending] = useState<"plan" | "remove" | "status" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const lock = useRef(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  async function preview() {
    if (lock.current) return;
    lock.current = true;
    setPending("plan");
    setError(null);
    setPlan(null);
    try {
      const fresh = await workspaceRequest(
        "workspaces.get",
        { workspaceId: workspace.id },
        context,
      );
      if (!fresh) throw new Error(t("This workspace is no longer available."));
      setPlan(
        await workspaceRequest(
          "workspaces.cleanup.plan",
          { workspaceId: fresh.id, expectedRevision: fresh.revision },
          context,
        ),
      );
      setNow(Date.now());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      lock.current = false;
      setPending(null);
    }
  }
  useEffect(() => {
    void preview();
  }, [workspace.id]);
  async function remove() {
    if (!plan || lock.current || plan.expiresAt <= Date.now() || plan.blockers.length) return;
    lock.current = true;
    setPending("remove");
    setError(null);
    try {
      await workspaceRequest(
        "workspaces.cleanup.apply",
        {
          workspaceId: workspace.id,
          expectedRevision: plan.expectedRevision,
          idempotencyKey: workspaceOperationKey(),
          planToken: plan.token,
        },
        context,
      );
      const result = await workspaceRequest(
        "workspaces.cleanup.status",
        { workspaceId: workspace.id },
        context,
      );
      onWorkspaceChange?.(result.workspace);
      if (result.workspace.directoryState === "removed") onClose();
      else {
        setUncertain(true);
        setError(t("Directory removal is not complete. Check its status before continuing."));
      }
    } catch (reason) {
      setUncertain(true);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      lock.current = false;
      setPending(null);
    }
  }
  async function status() {
    if (lock.current) return;
    lock.current = true;
    setPending("status");
    setError(null);
    try {
      const result = await workspaceRequest(
        "workspaces.cleanup.status",
        { workspaceId: workspace.id },
        context,
      );
      onWorkspaceChange?.(result.workspace);
      if (result.workspace.directoryState === "removed") onClose();
      else if (
        result.workspace.directoryState === "present" ||
        result.workspace.directoryState === "blocked"
      ) {
        setUncertain(false);
        setPlan(null);
      } else setError(t("Directory removal is still in progress. Check again."));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      lock.current = false;
      setPending(null);
    }
  }
  return (
    <Modal
      title={t("Delete worktree directory")}
      onClose={() => {
        if (!lock.current) onClose();
      }}
      footer={
        <ModalActions>
          <Button variant="secondary" disabled={!!pending} onClick={onClose}>
            {t("Cancel")}
          </Button>
          {uncertain ? (
            <Button loading={pending === "status"} onClick={() => void status()}>
              {t("Check removal status")}
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                loading={pending === "plan"}
                disabled={!!pending && pending !== "plan"}
                onClick={() => void preview()}
              >
                {t("Refresh preview")}
              </Button>
              <Button
                variant="primary"
                tone="danger"
                loading={pending === "remove"}
                disabled={!!pending || !plan || !!plan.blockers.length || plan.expiresAt <= now}
                onClick={() => void remove()}
              >
                {t("Delete directory")}
              </Button>
            </>
          )}
        </ModalActions>
      }
    >
      <div className="space-y-3 text-ui-body">
        <p>
          {t(
            "The conversation, branch and recovery history are retained. Resume recreates the directory.",
          )}
        </p>
        <p className="break-all font-mono text-(--ui-text-secondary)">
          {plan?.path ?? workspace.path}
        </p>
        {pending === "plan" && <LoadingText>{t("Checking directory…")}</LoadingText>}
        {error && <InlineError className="break-words">{error}</InlineError>}
        {plan && (
          <>
            <p className="break-all">
              {plan.branchRef} · {plan.head.slice(0, 12)}
            </p>
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
      </div>
    </Modal>
  );
}
