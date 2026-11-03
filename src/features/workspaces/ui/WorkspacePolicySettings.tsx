import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Badge } from "../../../shared/ui/Badge";
import { InlineError } from "../../../shared/ui/InlineError";
import { Switch } from "../../../shared/ui/Switch";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { MoreHorizontal, FolderTree } from "../../../shared/ui/icons";
import { revealPath } from "../../../platform/tauri/fs";
import type { Session } from "../../sessions/model/session";
import worktreeStyles from "../../source-control/ui/WorktreesPage.module.css";
import { WorkspaceDirectoryRemoval } from "./WorkspaceDirectoryRemoval";
import { WorkspaceReview } from "./WorkspaceReview";
import { NumberField } from "../../../shared/ui/NumberField";
import { Select } from "../../../shared/ui/Select";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { AdvancedSettings, Group, Row, SettingsFeedback } from "../../settings/ui/settingsControls";
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

const GIB = 1_073_741_824;
const DAY = 86_400_000;
const retentionStates = ["idle", "finished", "merged", "abandoned"] as const;

export function workspaceStorageSize(bytes: number | null): string {
  return bytes === null ? t("Unknown") : `${(bytes / GIB).toFixed(1)} GiB`;
}

type Stage = "inventory" | "policy" | "storage";

const samePolicy = (a: WorkspacePolicy, b: WorkspacePolicy) =>
  JSON.stringify(a) === JSON.stringify(b);

/** The Host accepts only positive, safe-integer byte counts (host/workspace-policy.ts). */
const positiveBytes = (value: number) =>
  Number.isFinite(value) && value > 0 && Number.isSafeInteger(value);

/** An emptied or invalid field stays visible as typed instead of being rewritten. */
const fieldValue = (value: number) => (Number.isFinite(value) ? value : "");

export type PolicyDiskErrors = { budget?: string; warning?: string; minimumFree?: string };

/** Mirrors the Host contract so Save is never offered for a value it will reject. */
export function workspacePolicyDiskErrors(disk: WorkspacePolicy["disk"]): PolicyDiskErrors {
  const errors: PolicyDiskErrors = {};
  if (!positiveBytes(disk.budgetBytes))
    errors.budget = t("Enter a directory budget greater than 0 GiB.");
  if (!Number.isFinite(disk.warningRatio) || disk.warningRatio <= 0 || disk.warningRatio > 1)
    errors.warning = t("Enter a warning from 1 to 100%.");
  if (!positiveBytes(disk.minimumFreeBytes))
    errors.minimumFree = t("Enter minimum free space greater than 0 GiB.");
  return errors;
}

function lifecycleLabel(state: ManagedWorkspace["state"]) {
  return {
    active: t("Active"),
    idle: t("Idle"),
    finished: t("Finished"),
    merged: t("Merged"),
    abandoned: t("Closed"),
  }[state];
}

/** Policy lives on the execution Host. No local preference can authorize cleanup. */
export function WorkspacePolicySettings({
  cwd,
  environmentId,
  onInventory,
  renderWorktrees,
  hasWorktreeMatches,
  liveSessions = [],
  policyCollapsed = false,
  renderHeader,
}: {
  renderHeader?: (refresh: () => Promise<void>, busy: boolean, disabled: boolean) => ReactNode;
  hasWorktreeMatches?: (query: string) => boolean;
  renderWorktrees?: (query: string) => ReactNode;
  liveSessions?: Session[];
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
  const [review, setReview] = useState<ManagedWorkspace>();
  const [pinning, setPinning] = useState<string>();
  const [pinError, setPinError] = useState<{ id: string; message: string }>();
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<{ workspace: ManagedWorkspace; anchor: HTMLElement }>();
  const [revealError, setRevealError] = useState<string>();
  const workspaceTitle = (workspace: ManagedWorkspace) =>
    liveSessions.find((session) => session.id === workspace.owner.id)?.title ||
    (workspace.branchRef.startsWith("refs/heads/bycoda/") ||
    workspace.branchRef.startsWith("bycoda/")
      ? t("{p0} workspace", { p0: workspace.owner.kind })
      : workspace.branchRef.replace(/^refs\/heads\//, ""));
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
  const invalidDisk = !draft || Object.keys(diskErrors).length > 0;
  const hasProjectOverride = !!policy?.resolved.appliedScopes.includes("project");
  const search = query.trim().toLocaleLowerCase();
  const visibleWorkspaces = search
    ? workspaces.filter((workspace) =>
        [
          workspaceTitle(workspace),
          workspace.branchRef,
          workspace.path,
          lifecycleLabel(workspace.state),
          `${workspace.owner.kind} ${workspace.owner.id}`,
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(search),
      )
    : workspaces;
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
      className="flex min-w-0 flex-col gap-4 [&>.settings-group]:pt-0"
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
          {!renderHeader && <h3 className="text-ui-secondary font-medium">{t("Worktrees")}</h3>}
          {capabilities && !capabilities.includes(WORKSPACE_PINNING_CAPABILITY) && (
            <SettingsFeedback state="warning">
              {t("Update the execution Host to pin or unpin individual workspaces.")}
            </SettingsFeedback>
          )}
          {!workspaces.length && !renderWorktrees ? (
            <p role="status" className="text-ui-caption text-(--ui-text-secondary)">
              {t(
                "No managed workspace directories yet. Workspaces created by sessions appear here.",
              )}
            </p>
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
              />
              {!visibleWorkspaces.length && !(hasWorktreeMatches?.(query) ?? !!renderWorktrees) ? (
                <div className="settings-collection-empty" role="status">
                  <p>{t("No results")}</p>
                  <Button size="sm" variant="ghost" onClick={() => setQuery("")}>
                    {t("Clear search")}
                  </Button>
                </div>
              ) : (
                <div role="list" aria-label={t("Worktrees")} className="settings-collection-list">
                  {visibleWorkspaces.map((workspace) => (
                    <div
                      key={workspace.id}
                      role="listitem"
                      className={`settings-collection-row ${worktreeStyles.row}`}
                    >
                      <FolderTree aria-hidden="true" className={worktreeStyles.treeIcon} />
                      <div className={`settings-collection-main ${worktreeStyles.identity}`}>
                        <p className={worktreeStyles.name}>{workspaceTitle(workspace)}</p>
                        <div className="flex flex-wrap items-center gap-2 text-ui-caption text-(--ui-text-secondary)">
                          <Badge size="sm">{lifecycleLabel(workspace.state)}</Badge>
                          {workspace.pinned && <Badge size="sm">{t("Pinned")}</Badge>}
                          {workspace.directoryState === "blocked" && (
                            <Badge size="sm" tone="warning">
                              {t("Cleanup blocked")}
                            </Badge>
                          )}
                          {workspace.directoryState === "removed" && (
                            <Badge size="sm">{t("Directory removed")}</Badge>
                          )}
                          {workspace.directoryState === "pendingRemoval" ||
                          workspace.directoryState === "removing" ? (
                            <Badge size="sm">{t("Removing directory…")}</Badge>
                          ) : null}
                        </div>
                        <details className="text-ui-caption text-(--ui-text-secondary)">
                          <summary>{t("Details")}</summary>
                          <p className="break-all">{workspace.path}</p>
                          <p>
                            {workspace.branchRef} · {workspace.id}
                          </p>
                          <p>
                            {t("Owner: {p0}", {
                              p0: `${workspace.owner.kind} ${workspace.owner.id}`,
                            })}
                          </p>
                        </details>
                        {pinError?.id === workspace.id && (
                          <InlineError className="break-words">{pinError.message}</InlineError>
                        )}
                      </div>
                      <div className={`settings-collection-actions ${worktreeStyles.rowActions}`}>
                        <Button
                          size="sm"
                          disabled={
                            !capabilities?.includes("workspaces.delivery.v1") || loading || removing
                          }
                          onClick={() => setReview(workspace)}
                        >
                          {t("Review changes")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          iconOnly
                          label={t("More actions")}
                          loading={pinning === workspace.id}
                          aria-haspopup="menu"
                          aria-expanded={menu?.workspace.id === workspace.id}
                          onClick={(event) => setMenu({ workspace, anchor: event.currentTarget })}
                        >
                          <MoreHorizontal className="icon-sm" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  {renderWorktrees?.(query)}
                </div>
              )}
            </div>
          )}
        </section>
      )}
      {stageNotice("policy", t("Workspace policy"), !!policy)}
      {stageNotice("storage", t("Workspace storage"), !!storage)}
      <AdvancedSettings
        title={t("Workspace policy")}
        defaultOpen={!policyCollapsed}
        settingIds={[
          "workspace-policy",
          "default-workspace-mode",
          "workspace-pinning",
          "workspace-retention",
          "workspace-disk-policy",
          "workspace-storage-status",
        ]}
      >
        {capabilities && !capabilities.includes("workspaces.policy.v1") && (
          <SettingsFeedback state="warning">
            {t("Update the execution Host to configure worktree defaults and retention.")}
          </SettingsFeedback>
        )}
        {draft && policy && (
          <Group
            title={
              <span className="flex flex-wrap items-center gap-2">
                {t("Workspace policy")}
                <Badge size="sm">
                  {hasProjectOverride ? t("Project override") : t("Following Host defaults")}
                </Badge>
              </span>
            }
            layout="full"
            id="workspace-policy"

            info={
              <InfoPopover>
                <p>
                  {t(
                    "Saving stores every value as a project override. Reset removes the whole override immediately.",
                  )}
                </p>
              </InfoPopover>
            }
            persistence={{
              mode: "explicit",
              state: saving ? "saving" : saved ? "saved" : dirty ? "dirty" : "idle",
            }}
            action={
              <div className="flex items-center gap-2">
                {dirty ? (
                  <Button variant="ghost" disabled={saving || loading} onClick={discardDraft}>
                    {t("Discard changes")}
                  </Button>
                ) : null}
                {dirty && (
                  <Button
                    variant="primary"
                    loading={saving}
                    loadingLabel={t("Saving…")}
                    disabled={!dirty || invalidDisk || loading || policyConflict}
                    onClick={() => void save()}
                  >
                    {t("Save workspace policy")}
                  </Button>
                )}
              </div>
            }
          >
            {policyConflict ? (
              <SettingsFeedback
                state="warning"
                action={
                  <>
                    <Button variant="ghost" disabled={saving} onClick={discardDraft}>
                      {t("Reload Host policy")}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={saving}
                      onClick={() => setPolicyConflict(false)}
                    >
                      {t("Keep my edits")}
                    </Button>
                  </>
                }
              >
                {t(
                  "The saved policy changed while you were editing. Reload it and lose your edits, or keep them and save over the new revision.",
                )}
              </SettingsFeedback>
            ) : null}
            <Row id="default-workspace-mode" label={t("Default workspace")}>
              <fieldset disabled={saving}>
                <SegmentedControl
                  label={t("Default workspace")}
                  value={draft.defaultMode}
                  options={[
                    { value: "worktree", label: t("Worktree") },
                    { value: "current", label: t("Current checkout") },
                  ]}
                  onValueChange={(defaultMode) =>
                    update({ ...draft, defaultMode: defaultMode as WorkspacePolicy["defaultMode"] })
                  }
                />
              </fieldset>
            </Row>
            <Row
              id="workspace-pinning"
              label={t("Pin new workspaces")}
              description={t("Pinned workspaces are excluded from automatic directory cleanup.")}
              descriptionVisible={false}
            >
              <Switch
                aria-label={t("Pin new workspaces")}
                checked={draft.pinned}
                disabled={saving}
                onCheckedChange={(pinned) => update({ ...draft, pinned })}
              />
            </Row>
            <AdvancedSettings
              id="workspace-retention"
              title={
                <span>
                  {t("Directory retention")} ·{" "}
                  <span className="text-(--ui-text-secondary)">
                    {retentionStates
                      .map(
                        (state) =>
                          `${lifecycleLabel(state)}: ${draft.retention[state] === "never" ? t("Never") : t("{p0} days", { p0: Number(draft.retention[state]) / DAY })}`,
                      )
                      .join(" · ")}
                  </span>
                </span>
              }
              defaultOpen={false}
            >
              <Row label={t("Active")}>
                <span>{t("Never")}</span>
              </Row>
              {retentionStates.map((state) => {
                const period = draft.retention[state];
                const choices = [DAY, 7 * DAY, 14 * DAY, 30 * DAY, "never"] as const;
                return (
                  <Row key={state} label={lifecycleLabel(state)}>
                    <Select
                      className="w-36"
                      label={t("{p0} retention", { p0: lifecycleLabel(state) })}
                      value={String(period)}
                      disabled={saving}
                      options={[
                        ...choices.map((value) => ({
                          value: String(value),
                          label:
                            value === "never"
                              ? t("Never")
                              : value === DAY
                                ? t("24 hours")
                                : t("{p0} days", { p0: value / DAY }),
                        })),
                        ...(!choices.includes(period as (typeof choices)[number])
                          ? [
                              {
                                value: String(period),
                                label: t("{p0} days", { p0: Number(period) / DAY }),
                              },
                            ]
                          : []),
                      ]}
                      onValueChange={(value) =>
                        update({
                          ...draft,
                          retention: {
                            ...draft.retention,
                            [state]: value === "never" ? "never" : Number(value),
                          },
                        })
                      }
                    />
                  </Row>
                );
              })}
            </AdvancedSettings>
            <AdvancedSettings
              id="workspace-disk-policy"
              title={
                <span>
                  {t("Storage limits")} · {workspaceStorageSize(draft.disk.budgetBytes)}
                </span>
              }
              defaultOpen={false}
            >
              <Row label={t("Directory budget (GiB)")}>
                <NumberField
                  className="w-36"
                  label={t("Directory budget (GiB)")}
                  hideLabel
                  aria-label={t("Directory budget (GiB)")}
                  min={1}
                  step={1}
                  disabled={saving}
                  error={diskErrors.budget}
                  value={fieldValue(draft.disk.budgetBytes / GIB)}
                  onChange={(event) =>
                    update({
                      ...draft,
                      disk: { ...draft.disk, budgetBytes: event.target.valueAsNumber * GIB },
                    })
                  }
                />
              </Row>
              <Row label={t("Warn at (%)")}>
                <NumberField
                  className="w-36"
                  label={t("Warn at (%)")}
                  hideLabel
                  aria-label={t("Warn at (%)")}
                  min={1}
                  max={100}
                  step={1}
                  disabled={saving}
                  error={diskErrors.warning}
                  value={fieldValue(draft.disk.warningRatio * 100)}
                  onChange={(event) =>
                    update({
                      ...draft,
                      disk: { ...draft.disk, warningRatio: event.target.valueAsNumber / 100 },
                    })
                  }
                />
              </Row>
              <Row label={t("Minimum free space (GiB)")}>
                <NumberField
                  className="w-36"
                  label={t("Minimum free space (GiB)")}
                  hideLabel
                  aria-label={t("Minimum free space (GiB)")}
                  min={1}
                  step={1}
                  disabled={saving}
                  error={diskErrors.minimumFree}
                  value={fieldValue(draft.disk.minimumFreeBytes / GIB)}
                  onChange={(event) =>
                    update({
                      ...draft,
                      disk: { ...draft.disk, minimumFreeBytes: event.target.valueAsNumber * GIB },
                    })
                  }
                />
              </Row>
            </AdvancedSettings>
            {hasProjectOverride && (
              <Row
                label={t("Reset to Host defaults")}
                descriptionVisible={false}
                description={t(
                  "Removes this project's whole override, including values you did not edit. This saves immediately.",
                )}
              >
                <Button variant="link" disabled={saving || loading} onClick={() => void save({})}>
                  {t("Reset to Host defaults")}
                </Button>
              </Row>
            )}
          </Group>
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
        {storage && (
          <Group
            id="workspace-storage-status"
            title={t("Workspace storage")}
            layout="full"
            scope={
              stageBusy.storage
                ? t("Refreshing storage…")
                : stageError.storage
                  ? t("Showing the last storage reading.")
                  : t(
                      "Read from the Host when this page last refreshed. Directory sizes can be unknown, and removing a directory may not free its full size.",
                    )
            }
          >
            <Row label={t("Directories")}>
              {storage.materializedBytes !== null &&
                storage.materializedBytes >= storage.budgetBytes * storage.warningRatio && (
                  <Badge size="sm" tone="warning">
                    {t("Storage warning")}
                  </Badge>
                )}
              <span className="tabular-nums">
                {workspaceStorageSize(storage.materializedBytes)} /{" "}
                {workspaceStorageSize(storage.budgetBytes)}
              </span>
            </Row>
            <Row label={t("Free space")}>
              <span className="tabular-nums">{workspaceStorageSize(storage.freeBytes)}</span>
            </Row>
            <AdvancedSettings title={t("Cache and recovery storage")} defaultOpen={false}>
              <Row label={t("Shared caches")}>
                <span className="tabular-nums">
                  {workspaceStorageSize(storage.sharedCacheBytes)}
                </span>
              </Row>
              <Row label={t("Recovery objects")}>
                <span className="tabular-nums">{workspaceStorageSize(storage.recoveryBytes)}</span>
              </Row>
              <p className="break-all p-3 text-ui-caption text-(--ui-text-secondary)">
                {storage.root}
              </p>
            </AdvancedSettings>
            {storage.materialization !== "allowed" && (
              <SettingsFeedback state="warning">
                {storage.materialization === "paused"
                  ? t("New workspaces are paused. Required free space: {p0}.", {
                      p0: workspaceStorageSize(storage.requiredFreeBytes),
                    })
                  : t(
                      "Storage availability is unknown. Refresh workspace status before creating a directory.",
                    )}
              </SettingsFeedback>
            )}
          </Group>
        )}
      </AdvancedSettings>
      {revealError && <SettingsFeedback state="error">{revealError}</SettingsFeedback>}
      {menu && (
        <DropdownMenu
          anchor={menu.anchor}
          label={t("More actions")}
          onClose={() => setMenu(undefined)}
          items={[
            {
              kind: "item",
              id: "pin",
              label: menu.workspace.pinned ? t("Unpin workspace") : t("Pin workspace"),
              disabled:
                !capabilities?.includes(WORKSPACE_PINNING_CAPABILITY) ||
                loading ||
                removing ||
                !!pinning,
            },
            {
              kind: "item",
              id: "reveal",
              label: t("Reveal folder"),
              disabled: menu.workspace.directoryState === "removed",
            },
            {
              kind: "item",
              id: "delete",
              label:
                menu.workspace.directoryState === "blocked"
                  ? t("Review blocked cleanup")
                  : t("Delete directory"),
              danger: true,
              disabled:
                !capabilities?.includes("workspaces.lifecycle.v1") ||
                menu.workspace.state === "active" ||
                removing ||
                ["removed", "removing", "pendingRemoval"].includes(menu.workspace.directoryState),
            },
          ]}
          onPick={(id) => {
            const workspace = menu.workspace;
            setMenu(undefined);
            if (id === "pin") void pinWorkspace(workspace);
            if (id === "delete") setCleanup(workspace);
            if (id === "reveal") {
              setRevealError(undefined);
              void revealPath(workspace.path).catch((failure) => setRevealError(String(failure)));
            }
          }}
        />
      )}
      {cleanup && (
        <WorkspaceDirectoryRemoval
          workspace={cleanup}
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
