import { EmptyState } from "../../../shared/ui/EmptyState";
import { ScrollArea } from "../../../shared/ui/ScrollArea";
import { Text } from "../../../shared/ui/Text";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { WorkspacePolicyEditor } from "./WorkspacePolicyEditor";
import styles from "./WorkspacePolicySettings.module.css";
import {
  workspacePolicyDiskErrors,
  lifecycleLabel,
  matchesRosterFilter,
  workspaceRemovalAction,
  workspaceRosterFacts,
  type RosterFilter,
} from "../model/workspacePresentation";
import { Button } from "../../../shared/ui/Button";
import { Heading } from "../../../shared/ui/Heading";
import { WorkspaceManagedRow } from "./WorkspaceManagedRow";
import { WorkspaceStorageSummary } from "./WorkspaceStorageSummary";
import { WorkspaceRosterFilter } from "./WorkspaceRosterFilter";
import { revealPath } from "../../../platform/tauri/fs";
import type { Session } from "../../sessions/model/session";
import { WorkspaceDirectoryRemoval } from "./WorkspaceDirectoryRemoval";
import { WorkspaceReview } from "./WorkspaceReview";
import { SettingsFeedback } from "../../settings/public/settingsControls";
import { CollectionToolbar } from "../../settings/ui/SettingsCollection";
import type {
  ManagedWorkspace,
  WorkspacePolicy,
  WorkspacePolicyOverride,
  WorkspaceRpcResponse,
  WorkspaceStorageStatus,
} from "../model/contracts";
import {
  getWorkspaceCapabilities,
  resolveWorkspaceContext,
  workspaceRequest,
} from "../model/workspaceClient";
import { setWorkspacePinned, WORKSPACE_PINNING_CAPABILITY } from "../model/workspacePinning";
import { isBackgroundRemoval } from "../model/backgroundRemoval";
import { useBackgroundRemovals } from "../hooks/useBackgroundRemovals";

type Stage = "inventory" | "policy" | "storage";
const samePolicy = (a: WorkspacePolicy, b: WorkspacePolicy) =>
  JSON.stringify(a) === JSON.stringify(b);
export {
  workspacePolicyDiskErrors,
  workspaceStorageSize,
  type PolicyDiskErrors,
} from "../model/workspacePresentation";

/** Policy lives on the execution Host. No local preference can authorize cleanup. */
export function WorkspacePolicySettings({
  cwd,
  environmentId,
  onInventory,
  renderWorktrees,
  hasWorktreeMatches,
  liveSessions = [],
  renderHeader,
}: {
  renderHeader?: (refresh: () => Promise<void>, busy: boolean, disabled: boolean) => ReactNode;
  hasWorktreeMatches?: (query: string) => boolean;
  renderWorktrees?: (query: string) => ReactNode;
  liveSessions?: Session[];
  /** @deprecated no longer collapses */
  policyCollapsed?: boolean;
  cwd: string;
  environmentId?: string;
  onInventory?: (workspaces: ManagedWorkspace[] | null) => void;
}) {
  useLocale();
  const [capabilities, setCapabilities] = useState<string[]>();
  const [policy, setPolicy] = useState<WorkspaceRpcResponse<"projects.workspacePolicy.get">>();
  const [draft, setDraft] = useState<WorkspacePolicy>();
  const [storage, setStorage] = useState<WorkspaceStorageStatus>();
  const [workspaces, setWorkspaces] = useState<ManagedWorkspace[]>([]);
  const [inventoryLoaded, setInventoryLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  /** Per-section read outcome: a failed stage keeps its last good data and says so. */
  const [stageError, setStageError] = useState<Partial<Record<Stage, string>>>({});
  const [stageBusy, setStageBusy] = useState<Partial<Record<Stage, boolean>>>({});
  /** Host policy changed while the draft held unsaved edits. */
  const [policyConflict, setPolicyConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();
  const [cleanup, setCleanup] = useState<ManagedWorkspace>();
  const [cleanupMode, setCleanupMode] = useState({ closeFirst: false, missing: false });
  const [review, setReview] = useState<ManagedWorkspace>();
  const [pinning, setPinning] = useState<string>();
  const [pinError, setPinError] = useState<{ id: string; message: string }>();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RosterFilter>("all");
  const [revealError, setRevealError] = useState<string>();
  const backgroundRemovals = useBackgroundRemovals();
  const workspaceTitle = (workspace: ManagedWorkspace) =>
    (workspace.owner.kind === "session" &&
      liveSessions.find((session) => session.id === workspace.owner.id)?.title) ||
    workspace.branchRef.replace(/^refs\/heads\//, "");
  const removing = !!cleanup;
  const epoch = useRef(0);
  const saveAttempt = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
  const resolvedContext = useRef<
    { cwd: string; projectId: string; environmentId: string; machineId?: string } | undefined
  >(undefined);
  const capabilitiesRef = useRef<string[] | undefined>(undefined);
  const policyRef = useRef<WorkspaceRpcResponse<"projects.workspacePolicy.get"> | undefined>(
    undefined,
  );
  const draftRef = useRef<WorkspacePolicy | undefined>(undefined);
  const inventoryCallback = useRef(onInventory);
  useEffect(() => {
    inventoryCallback.current = onInventory;
  }, [onInventory]);
  const scope = useCallback(
    () => resolvedContext.current ?? { cwd, environmentId },
    [cwd, environmentId],
  );
  const commitPolicy = (next: WorkspaceRpcResponse<"projects.workspacePolicy.get"> | undefined) => {
    policyRef.current = next;
    setPolicy(next);
  };
  const commitDraft = (next: WorkspacePolicy | undefined) => {
    draftRef.current = next;
    setDraft(next);
  };
  /** Takes a freshly read Host policy without discarding unsaved edits. */
  const adoptPolicy = (next: WorkspaceRpcResponse<"projects.workspacePolicy.get">) => {
    const previous = policyRef.current;
    const editing = draftRef.current;
    const hasEdits = !!previous && !!editing && !samePolicy(previous.resolved.policy, editing);
    commitPolicy(next);
    if (!hasEdits) {
      commitDraft(next.resolved.policy);
      setPolicyConflict(false);
    } else if (
      previous &&
      (next.revision !== previous.revision ||
        !samePolicy(next.resolved.policy, previous.resolved.policy))
    ) {
      setPolicyConflict(true);
    }
  };
  const runStage = useCallback(
    async (stage: Stage, requestEpoch: number) => {
      const context = resolvedContext.current;
      const caps = capabilitiesRef.current;
      if (!context || !caps) return;
      const args = { projectId: context.projectId, environmentId: context.environmentId };
      setStageBusy((busy) => ({ ...busy, [stage]: true }));
      try {
        if (stage === "inventory") {
          const inventory = caps.includes("workspaces.managed.v1")
            ? await workspaceRequest("workspaces.list", args, scope())
            : [];
          if (epoch.current !== requestEpoch) return;
          setWorkspaces(inventory);
          setInventoryLoaded(true);
          inventoryCallback.current?.(inventory);
        } else if (stage === "policy") {
          if (!caps.includes("workspaces.policy.v1")) return;
          const next = await workspaceRequest("projects.workspacePolicy.get", args, scope());
          if (epoch.current !== requestEpoch) return;
          adoptPolicy(next);
        } else {
          if (!caps.includes("workspaces.lifecycle.v1")) return;
          const next = await workspaceRequest("workspaces.storage.status", args, scope());
          if (epoch.current !== requestEpoch) return;
          setStorage(next);
        }
        setStageError((errors) => ({ ...errors, [stage]: undefined }));
      } catch (failure) {
        if (epoch.current === requestEpoch)
          setStageError((errors) => ({ ...errors, [stage]: String(failure) }));
      } finally {
        if (epoch.current === requestEpoch) setStageBusy((busy) => ({ ...busy, [stage]: false }));
      }
    },
    // adoptPolicy only touches refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope],
  );
  const refresh = useCallback(async () => {
    const requestEpoch = ++epoch.current;
    setLoading(true);
    setError(undefined);
    inventoryCallback.current?.(null);
    try {
      const context = await resolveWorkspaceContext(cwd);
      if (epoch.current !== requestEpoch) return;
      resolvedContext.current = context;
      const caps = await getWorkspaceCapabilities(scope());
      if (epoch.current !== requestEpoch) return;
      capabilitiesRef.current = caps;
      setCapabilities(caps);
      // Each section keeps its last good data and reports its own failure, so one
      // failed read never hides or freezes the others.
      for (const stage of ["inventory", "policy", "storage"] as const)
        await runStage(stage, requestEpoch);
    } catch (failure) {
      if (epoch.current === requestEpoch) setError(String(failure));
    } finally {
      if (epoch.current === requestEpoch) setLoading(false);
    }
  }, [cwd, scope, runStage]);
  /** Roster and storage change after a review or cleanup; the policy draft is left alone. */
  const refreshRoster = useCallback(async () => {
    const requestEpoch = epoch.current;
    await runStage("inventory", requestEpoch);
    await runStage("storage", requestEpoch);
  }, [runStage]);
  useEffect(() => {
    setPolicy(undefined);
    policyRef.current = undefined;
    draftRef.current = undefined;
    setDraft(undefined);
    setStorage(undefined);
    setCapabilities(undefined);
    capabilitiesRef.current = undefined;
    setCleanup(undefined);
    setReview(undefined);
    setWorkspaces([]);
    setInventoryLoaded(false);
    setStageError({});
    setStageBusy({});
    setPolicyConflict(false);
    setQuery("");
    setFilter("all");
    setPinning(undefined);
    setPinError(undefined);
    setSaved(false);
    saveAttempt.current = undefined;
    resolvedContext.current = undefined;
    if (cwd && cwd !== "~") void refresh();
    return () => {
      ++epoch.current;
    };
  }, [cwd, refresh]);

  const save = async (override?: WorkspacePolicyOverride) => {
    if (!policy || !draft || saving) return;
    const requestEpoch = epoch.current;
    setSaving(true);
    setError(undefined);
    setSaved(false);
    const fingerprint = JSON.stringify({ revision: policy.revision, override: override ?? draft });
    if (saveAttempt.current?.fingerprint !== fingerprint) {
      saveAttempt.current = { fingerprint, key: crypto.randomUUID() };
    }
    try {
      const next = await workspaceRequest(
        "projects.workspacePolicy.update",
        {
          projectId: resolvedContext.current?.projectId ?? cwd,
          environmentId: resolvedContext.current?.environmentId ?? environmentId ?? "",
          expectedRevision: policy.revision,
          idempotencyKey: saveAttempt.current.key,
          policy: override ?? draft,
        },
        scope(),
      );
      if (epoch.current !== requestEpoch) return;
      commitPolicy(next);
      commitDraft(next.resolved.policy);
      setPolicyConflict(false);
      setSaved(true);
      saveAttempt.current = undefined;
      // Storage limits just changed. The policy draft is already settled, so a storage
      // failure is reported on its own section with a local retry.
      void runStage("storage", requestEpoch);
    } catch (failure) {
      if (epoch.current === requestEpoch) setError(String(failure));
    } finally {
      setSaving(false);
    }
  };
  const update = (next: WorkspacePolicy) => {
    commitDraft(next);
    setSaved(false);
  };
  const discardDraft = () => {
    if (!policy) return;
    commitDraft(policy.resolved.policy);
    setPolicyConflict(false);
    setSaved(false);
    saveAttempt.current = undefined;
  };
  const pinWorkspace = async (workspace: ManagedWorkspace) => {
    if (pinning) return;
    const requestEpoch = epoch.current;
    setPinning(workspace.id);
    setPinError(undefined);
    try {
      const next = await setWorkspacePinned(workspace, !workspace.pinned, scope());
      if (epoch.current === requestEpoch)
        setWorkspaces((items) => items.map((item) => (item.id === next.id ? next : item)));
    } catch (failure) {
      if (epoch.current === requestEpoch)
        setPinError({ id: workspace.id, message: String(failure) });
    } finally {
      if (epoch.current === requestEpoch) setPinning(undefined);
    }
  };
  const dirty = !!policy && !!draft && !samePolicy(policy.resolved.policy, draft);
  const diskErrors = draft ? workspacePolicyDiskErrors(draft.disk) : {};
  const search = query.trim().toLocaleLowerCase();
  const rosterFacts = (workspace: ManagedWorkspace) =>
    workspaceRosterFacts(workspace, storage?.missingPaths ?? [], policy?.resolved.policy);
  const visibleWorkspaces = workspaces.filter(
    (workspace) =>
      matchesRosterFilter(filter, workspace, rosterFacts(workspace)) &&
      (!search ||
        [
          workspaceTitle(workspace),
          workspace.branchRef,
          workspace.path,
          lifecycleLabel(workspace.state),
          `${workspace.owner.kind} ${workspace.owner.id}`,
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(search)),
  );
  const showUnmanaged = filter === "all"; // unmanaged worktrees have no lifecycle to filter
  const showRoster =
    !!renderWorktrees ||
    !!workspaces.length ||
    (inventoryLoaded && !!capabilities?.includes("workspaces.managed.v1"));
  /** A failed read keeps the last good data visible, labelled stale, with a local retry. */
  const stageNotice = (stage: Stage, label: string, hasData: boolean) =>
    stageError[stage] ? (
      <SettingsFeedback
        state="warning"
        action={
          <Button
            variant="ghost"
            loading={!!stageBusy[stage]}
            loadingLabel={t("Refreshing…")}
            disabled={loading || saving || removing}
            onClick={() => void runStage(stage, epoch.current)}
          >
            {t("Retry")}
          </Button>
        }
      >
        {hasData
          ? t("{p0} could not refresh and may be out of date: {p1}", {
              p0: label,
              p1: stageError[stage],
            })
          : t("{p0} could not be read: {p1}", { p0: label, p1: stageError[stage] })}
      </SettingsFeedback>
    ) : null;
  if (!cwd || cwd === "~") return renderHeader?.(async () => {}, false, true) ?? null;

  return (
    <div
      role="group"
      aria-label={t("Managed workspaces")}
      className={styles.root}
      data-testid="workspace-policy-settings"
    >
      {renderHeader ? (
        renderHeader(refresh, loading, saving || removing)
      ) : (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            loading={loading}
            loadingLabel={t("Refreshing…")}
            disabled={saving || removing}
            onClick={() => void refresh()}
          >
            {t("Refresh workspace status")}
          </Button>
        </div>
      )}
      {error && <SettingsFeedback state="error">{error}</SettingsFeedback>}
      {stageNotice("inventory", t("Managed workspace directories"), inventoryLoaded)}
      {showRoster && (
        <section aria-label={t("Worktrees")} className="flex min-w-0 flex-col gap-2">
          {!renderHeader && <Heading size="item">{t("Worktrees")}</Heading>}
          {capabilities && !capabilities.includes(WORKSPACE_PINNING_CAPABILITY) && (
            <SettingsFeedback state="warning">
              {t("Update the execution Host to pin or unpin individual workspaces.")}
            </SettingsFeedback>
          )}
          {!workspaces.length && !renderWorktrees ? (
            <Text as="p" size="caption" tone="secondary" role="status">
              {t(
                "No managed workspace directories yet. Workspaces created by sessions appear here.",
              )}
            </Text>
          ) : (
            <div className="settings-collection">
              <CollectionToolbar
                label={t("Search worktrees")}
                query={query}
                onQueryChange={setQuery}
                count={
                  renderWorktrees
                    ? undefined
                    : t("Showing {p0} of {p1} workspaces", {
                        p0: visibleWorkspaces.length,
                        p1: workspaces.length,
                      })
                }
              >
                <WorkspaceRosterFilter value={filter} onValueChange={setFilter} />
              </CollectionToolbar>
              {!visibleWorkspaces.length &&
              !(showUnmanaged && (hasWorktreeMatches?.(query) ?? !!renderWorktrees)) ? (
                <Text
                  as="div"
                  size="caption"
                  tone="secondary"
                  leading="normal"
                  className="settings-collection-empty"
                  role="status"
                >
                  <EmptyState size="inline" kind="filtered" description={t("No results")} />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setQuery("");
                      setFilter("all");
                    }}
                  >
                    {t("Clear search")}
                  </Button>
                </Text>
              ) : (
                <ScrollArea
                  gutter="stable"
                  as="div"
                  role="list"
                  aria-label={t("Worktrees")}
                  className="settings-collection-list"
                >
                  {visibleWorkspaces.map((workspace) => (
                    <WorkspaceManagedRow
                      key={workspace.id}
                      workspace={workspace}
                      title={workspaceTitle(workspace)}
                      {...rosterFacts(workspace)}
                      reviewDisabled={
                        !capabilities?.includes("workspaces.delivery.v1") || loading || removing
                      }
                      pinning={pinning === workspace.id}
                      pinError={pinError?.id === workspace.id ? pinError.message : undefined}
                      removing={isBackgroundRemoval(backgroundRemovals, workspace.path)}
                      onReview={() => setReview(workspace)}
                      onReveal={() => {
                        setRevealError(undefined);
                        void revealPath(workspace.path).catch((failure) =>
                          setRevealError(String(failure)),
                        );
                      }}
                      pin={{
                        disabledReason: !capabilities?.includes(WORKSPACE_PINNING_CAPABILITY)
                          ? t("Update the execution Host to pin or unpin individual workspaces.")
                          : loading || removing || !!pinning
                            ? t("Wait for the current change to finish.")
                            : undefined,
                        onToggle: () => void pinWorkspace(workspace),
                      }}
                      remove={(() => {
                        const action = workspaceRemovalAction(
                          workspace,
                          rosterFacts(workspace),
                          !!capabilities?.includes("workspaces.lifecycle.v1"),
                        );
                        return {
                          label: action.label,
                          disabledReason:
                            action.disabledReason ??
                            (removing ? t("Another removal is open.") : undefined),
                          onRemove: () => {
                            setCleanupMode({
                              closeFirst: action.closeFirst,
                              missing: rosterFacts(workspace).missing,
                            });
                            setCleanup(workspace);
                          },
                        };
                      })()}
                    />
                  ))}
                  {showUnmanaged && renderWorktrees?.(query)}
                </ScrollArea>
              )}
            </div>
          )}
        </section>
      )}
      {stageNotice("storage", t("Workspace storage"), !!storage)}
      {storage && (
        <WorkspaceStorageSummary
          storage={storage}
          busy={!!stageBusy.storage}
          disabled={loading || saving || removing}
          stale={!!stageError.storage}
          onRefresh={() => void runStage("storage", epoch.current)}
        />
      )}
      {stageNotice("policy", t("Workspace policy"), !!policy)}
      {/* No wrapper: the editor's Group and Rows carry the settings-search anchors. */}
      {capabilities && !capabilities.includes("workspaces.policy.v1") && (
        <SettingsFeedback state="warning">
          {t("Update the execution Host to configure worktree defaults and retention.")}
        </SettingsFeedback>
      )}
      {draft && policy && (
        <WorkspacePolicyEditor
          draft={draft}
          policy={policy}
          saving={saving}
          saved={saved}
          dirty={dirty}
          loading={loading}
          policyConflict={policyConflict}
          diskErrors={diskErrors}
          discardDraft={discardDraft}
          save={save}
          update={update}
          onKeepEdits={() => setPolicyConflict(false)}
        />
      )}
      {capabilities &&
        capabilities.includes("workspaces.policy.v1") &&
        !capabilities.includes("workspaces.lifecycle.v1") && (
          <SettingsFeedback state="warning">
            {t(
              "Update the execution Host to inspect storage and safely remove managed directories.",
            )}
          </SettingsFeedback>
        )}
      {revealError && <SettingsFeedback state="error">{revealError}</SettingsFeedback>}
      {cleanup && (
        <WorkspaceDirectoryRemoval
          workspace={cleanup}
          {...cleanupMode}
          context={{ cwd, environmentId }}
          onClose={() => setCleanup(undefined)}
          onWorkspaceChange={(next) => {
            setWorkspaces((items) => items.map((item) => (item.id === next.id ? next : item)));
            // Directory removal changes usage and free space; re-read storage on its own so
            // the summary is never left at its pre-removal numbers.
            if (next.directoryState === "removed" || next.directoryState === "removing")
              void runStage("storage", epoch.current);
          }}
        />
      )}
      {review && (
        <WorkspaceReview
          workspace={review}
          context={scope()}
          onClose={() => {
            setReview(undefined);
            // Only the roster and storage can have changed; an unsaved policy draft stays.
            void refreshRoster();
          }}
          onWorkspaceChange={(next) => {
            setReview(next);
            setWorkspaces((items) => items.map((item) => (item.id === next.id ? next : item)));
            inventoryCallback.current?.(
              workspaces.map((item) => (item.id === next.id ? next : item)),
            );
          }}
        />
      )}
    </div>
  );
}
