import { Text } from "../../../shared/ui/Text";
import { useEffect, useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { MoreHorizontal } from "../../../shared/ui/icons";
import { shouldPersistSession, upsertSession } from "../../sessions/data/sessionStore";
import { setSessions, useSession } from "../../sessions/model/sessionsStore";
import { remotePath, parseRemotePath } from "../../connections/model/remoteProjects";
import { hostSessionBinding } from "../../connections/model/sessionExecutionBinding";
import { useRemoteConnection } from "../../connections/model/useRemoteConnection";
import { classifyRemoteError, isConnectionFailure } from "../../connections/model/remoteFailure";
import { subscribeRemoteRecovered } from "../../connections/model/remoteHealth";
import type { ManagedWorkspace } from "../model/contracts";
import {
  getWorkspaceCapabilities,
  resolveWorkspaceContext,
  workspaceOperationKey,
  workspaceRequest,
} from "../model/workspaceClient";
import { WorkspaceDirectoryRemoval } from "./WorkspaceDirectoryRemoval";
import { WorkspaceReview } from "./WorkspaceReview";

/** Kept local until S1 adds the optional managed identity fields to Session. */
type ManagedIdentity = { workspaceId?: string; workspaceRevision?: number };

export function SessionWorkspaceActions({
  sessionId,
  cwd,
  enabled = true,
  onWorkspaceChange,
}: {
  sessionId: string;
  cwd: string;
  enabled?: boolean;
  onWorkspaceChange?: (workspace: ManagedWorkspace) => void;
}) {
  const t = useT();
  const session = useSession(sessionId);
  const environmentId =
    parseRemotePath(cwd)?.environmentId ?? (session && hostSessionBinding(session)?.environmentId);
  const connection = useRemoteConnection(environmentId);
  const workspaceId = (session as ManagedIdentity | undefined)?.workspaceId;
  const [workspace, setWorkspace] = useState<ManagedWorkspace | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  const [remove, setRemove] = useState(false);
  const [menu, setMenu] = useState(false);
  const [retry, setRetry] = useState(0);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const lock = useRef(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const managedCandidate = enabled && !!cwd && (!!workspaceId || !!session?.worktreeCwd);
  useEffect(
    () =>
      subscribeRemoteRecovered((recovered) => {
        if (managedCandidate && environmentId && (!recovered || recovered === environmentId))
          setRetry((value) => value + 1);
      }),
    [environmentId, managedCandidate],
  );
  useEffect(() => {
    setWorkspace(null);
    setError(null);
    if (!managedCandidate) return;
    let live = true;
    setPending("load");
    void (async () => {
      const advertised = await getWorkspaceCapabilities({ cwd });
      if (live) setCapabilities(advertised);
      const ids = await resolveWorkspaceContext(cwd);
      const result = workspaceId
        ? await workspaceRequest("workspaces.get", { workspaceId }, { cwd })
        : ((
            await workspaceRequest(
              "workspaces.list",
              { projectId: ids.projectId, environmentId: ids.environmentId },
              { cwd },
            )
          ).find((entry) => entry.owner.kind === "session" && entry.owner.id === sessionId) ??
          null);
      if (live) {
        setWorkspace(result);
        // Reconcile retained sessions after reload as well as after a button action.
        // Otherwise a removed directory could still look writable to the composer.
        if (result) changed(result);
      }
    })()
      .catch((reason) => {
        if (live) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (live) setPending(null);
      });
    return () => {
      live = false;
    };
  }, [cwd, sessionId, workspaceId, managedCandidate, retry]);

  function changed(next: ManagedWorkspace) {
    setWorkspace(next);
    setSessions((sessions) =>
      sessions.map((current) => {
        if (current.id !== sessionId) return current;
        const removed =
          next.directoryState === "removed" ||
          next.directoryState === "removing" ||
          next.directoryState === "pendingRemoval";
        const updated = {
          ...current,
          workspaceId: next.id,
          workspaceRevision: next.revision,
          worktreeCwd: parseRemotePath(cwd) ? remotePath(next.environmentId, next.path) : next.path,
          branch: next.branchRef.replace(/^refs\/heads\//, ""),
          worktreeRemoved: removed,
        };
        if (shouldPersistSession(updated))
          void upsertSession(updated).catch((reason: unknown) =>
            setError(reason instanceof Error ? reason.message : String(reason)),
          );
        return updated;
      }),
    );
    onWorkspaceChange?.(next);
  }
  async function lifecycle(action: "finish" | "close" | "resume") {
    if (!workspace || lock.current) return;
    lock.current = true;
    setPending(action);
    setError(null);
    setMenu(false);
    try {
      const fresh = await workspaceRequest(
        "workspaces.get",
        { workspaceId: workspace.id },
        { cwd },
      );
      if (!fresh) throw new Error(t("This workspace is no longer available."));
      changed(
        await workspaceRequest(
          `workspaces.${action}`,
          {
            workspaceId: fresh.id,
            expectedRevision: fresh.revision,
            idempotencyKey: workspaceOperationKey(),
          },
          { cwd },
        ),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      lock.current = false;
      setPending(null);
    }
  }
  if (!managedCandidate) return null;
  const connectionIssueHandled =
    !!environmentId &&
    connection.status !== "connected" &&
    (connection.status !== "connecting" || connection.reconnecting) &&
    !!error &&
    isConnectionFailure(classifyRemoteError(error));
  if (!workspace && connectionIssueHandled) return null;
  if (!workspace && !error && !pending) return null;
  const removed = workspace?.directoryState === "removed";
  const quickDelete =
    workspace &&
    (workspace.state === "finished" ||
      workspace.state === "merged" ||
      workspace.state === "abandoned") &&
    !removed;
  const lifecycleLabel = workspace
    ? {
        active: t("Active"),
        idle: t("Idle"),
        finished: t("Finished"),
        merged: t("Merged"),
        abandoned: t("Closed"),
      }[workspace.state]
    : "";
  return (
    <Text
      as="section"
      size="body"
      tone="inherit"
      aria-label={t("Session workspace")}
      className="min-w-0 space-y-2"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {workspace ? (
          <>
            <Text size="caption" tone="secondary" className="min-w-0 flex-1 break-all">
              {workspace.branchRef.replace(/^refs\/heads\//, "")} · {lifecycleLabel}
            </Text>
            {removed ? (
              <Button
                loading={pending === "resume"}
                disabled={!!pending || !!session?.busy}
                onClick={() => void lifecycle("resume")}
              >
                {t("Resume")}
              </Button>
            ) : (
              <Button
                variant="secondary"
                disabled={
                  !!pending || !!session?.busy || !capabilities.includes("workspaces.delivery.v1")
                }
                disabledReason={
                  !capabilities.includes("workspaces.delivery.v1")
                    ? t("Update bycoda Host to review and deliver workspace changes.")
                    : undefined
                }
                onClick={() => setReview(true)}
              >
                {t("Review changes")}
              </Button>
            )}
            {quickDelete && (
              <Button
                variant="ghost"
                disabled={
                  !!pending || !!session?.busy || !capabilities.includes("workspaces.lifecycle.v1")
                }
                onClick={() => setRemove(true)}
              >
                {t("Delete directory")}
              </Button>
            )}
            <Button
              ref={menuTrigger}
              variant="ghost"
              iconOnly
              label={t("Workspace actions")}
              loading={pending === "finish" || pending === "close"}
              disabled={!!pending || !!session?.busy}
              onClick={() => setMenu((value) => !value)}
            >
              <MoreHorizontal />
            </Button>
          </>
        ) : pending === "load" ? (
          <LoadingText />
        ) : null}
      </div>
      {removed && (
        <Text as="p" size="caption" tone="secondary">
          {t("The directory was removed. Your conversation and branch are retained.")}
        </Text>
      )}
      {workspace && !removed && !capabilities.includes("workspaces.delivery.v1") && (
        <Text as="p" size="caption" tone="secondary">
          {t("Update bycoda Host to review and deliver workspace changes.")}
        </Text>
      )}
      {error && !connectionIssueHandled && (
        <InlineError
          retry={{
            onRetry: () => setRetry((value) => value + 1),
            label: t("Retry workspace"),
            disabled: !!pending,
          }}
        >
          {error}
        </InlineError>
      )}
      {menu && workspace && (
        <DropdownMenu
          anchor={menuTrigger}
          returnFocusRef={menuTrigger}
          label={t("Workspace actions")}
          onClose={() => setMenu(false)}
          onPick={(id) => {
            setMenu(false);
            if (id === "remove") setRemove(true);
            else void lifecycle(id as "finish" | "close");
          }}
          items={[
            {
              kind: "item",
              id: "finish",
              label: t("Mark finished"),
              disabled: workspace.state === "merged" || workspace.state === "finished" || removed,
            },
            {
              kind: "item",
              id: "close",
              label: t("Close"),
              description: t("Keep the conversation and branch without delivery."),
              disabled: workspace.state === "merged" || workspace.state === "abandoned",
            },
            { kind: "sep" },
            {
              kind: "item",
              id: "remove",
              label: t("Delete worktree directory"),
              danger: true,
              disabled: removed || !capabilities.includes("workspaces.lifecycle.v1"),
            },
          ]}
        />
      )}
      {review && workspace && (
        <WorkspaceReview
          workspace={workspace}
          context={{ cwd }}
          onClose={() => setReview(false)}
          onWorkspaceChange={changed}
        />
      )}
      {remove && workspace && (
        <WorkspaceDirectoryRemoval
          workspace={workspace}
          context={{ cwd }}
          onClose={() => setRemove(false)}
          onWorkspaceChange={changed}
        />
      )}
    </Text>
  );
}
