import { useCallback, useEffect, useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Badge } from "../../../shared/ui/Badge";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { WorkspaceDirectoryRemoval } from "./WorkspaceDirectoryRemoval";
import { NumberField } from "../../../shared/ui/NumberField";
import { Select } from "../../../shared/ui/Select";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { AdvancedSettings, Group, Row, SettingsFeedback } from "../../settings/ui/settingsControls";
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
}: {
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
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();
  const [cleanup, setCleanup] = useState<ManagedWorkspace>();
  const [pinning, setPinning] = useState<string>();
  const [pinError, setPinError] = useState<{ id: string; message: string }>();
  const removing = !!cleanup;
  const epoch = useRef(0);
  const saveAttempt = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
  const resolvedContext = useRef<
    { cwd: string; projectId: string; environmentId: string; machineId?: string } | undefined
  >(undefined);
  const inventoryCallback = useRef(onInventory);
  useEffect(() => {
    inventoryCallback.current = onInventory;
  }, [onInventory]);
  const scope = useCallback(
    () => resolvedContext.current ?? { cwd, environmentId },
    [cwd, environmentId],
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
      setCapabilities(caps);
      const inventory = caps.includes("workspaces.managed.v1")
        ? await workspaceRequest(
            "workspaces.list",
            { projectId: context.projectId, environmentId: context.environmentId },
            scope(),
          )
        : [];
      if (epoch.current !== requestEpoch) return;
      setWorkspaces(inventory);
      inventoryCallback.current?.(inventory);
      if (caps.includes("workspaces.policy.v1")) {
        const next = await workspaceRequest(
          "projects.workspacePolicy.get",
          { projectId: context.projectId, environmentId: context.environmentId },
          scope(),
        );
        if (epoch.current !== requestEpoch) return;
        setPolicy(next);
        setDraft(next.resolved.policy);
      }
      if (caps.includes("workspaces.lifecycle.v1")) {
        const next = await workspaceRequest(
          "workspaces.storage.status",
          { projectId: context.projectId, environmentId: context.environmentId },
          scope(),
        );
        if (epoch.current !== requestEpoch) return;
        setStorage(next);
      }
    } catch (failure) {
      if (epoch.current === requestEpoch) setError(String(failure));
    } finally {
      if (epoch.current === requestEpoch) setLoading(false);
    }
  }, [cwd, environmentId, scope]);
  useEffect(() => {
    setPolicy(undefined);
    setDraft(undefined);
    setStorage(undefined);
    setCapabilities(undefined);
    setCleanup(undefined);
    setWorkspaces([]);
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
      setPolicy(next);
      setDraft(next.resolved.policy);
      setSaved(true);
      saveAttempt.current = undefined;
      if (capabilities?.includes("workspaces.lifecycle.v1")) {
        try {
          const nextStorage = await workspaceRequest(
            "workspaces.storage.status",
            {
              projectId: resolvedContext.current?.projectId ?? cwd,
              environmentId: resolvedContext.current?.environmentId ?? environmentId ?? "",
            },
            scope(),
          );
          if (epoch.current === requestEpoch) setStorage(nextStorage);
        } catch (failure) {
          if (epoch.current === requestEpoch)
            setError(
              t("Policy saved, but storage status could not refresh: {p0}", {
                p0: String(failure),
              }),
            );
        }
      }
    } catch (failure) {
      if (epoch.current === requestEpoch) setError(String(failure));
    } finally {
      setSaving(false);
    }
  };
  const update = (next: WorkspacePolicy) => {
    setDraft(next);
    setSaved(false);
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
  const dirty = policy && draft && JSON.stringify(policy.resolved.policy) !== JSON.stringify(draft);
  const invalidDisk =
    !draft ||
    !Number.isFinite(draft.disk.budgetBytes) ||
    draft.disk.budgetBytes <= 0 ||
    !Number.isFinite(draft.disk.minimumFreeBytes) ||
    draft.disk.minimumFreeBytes < 0 ||
    !Number.isFinite(draft.disk.warningRatio) ||
    draft.disk.warningRatio <= 0 ||
    draft.disk.warningRatio > 1;
  if (!cwd || cwd === "~") return null;

  return (
    <div
      className="flex min-w-0 flex-col gap-4 [&>.settings-group]:pt-0"
      data-testid="workspace-policy-settings"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-ui-secondary font-medium">{t("Managed workspaces")}</h3>
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
      {error && <SettingsFeedback state="error">{error}</SettingsFeedback>}
      {capabilities && !capabilities.includes("workspaces.policy.v1") && (
        <SettingsFeedback state="warning">
          {t("Update the execution Host to configure worktree defaults and retention.")}
        </SettingsFeedback>
      )}
      {draft && policy && (
        <Group
          title={t("Workspace policy")}
          layout="full"
          id="workspace-policy"
          persistence={{
            mode: "explicit",
            state: saving ? "saving" : saved ? "saved" : dirty ? "dirty" : "idle",
          }}
          action={
            <Button
              variant="primary"
              loading={saving}
              loadingLabel={t("Saving…")}
              disabled={!dirty || invalidDisk || loading}
              onClick={() => void save()}
            >
              {t("Save workspace policy")}
            </Button>
          }
        >
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
          >
            <Checkbox
              aria-label={t("Pin new workspaces")}
              checked={draft.pinned}
              disabled={saving}
              onChange={(event) => update({ ...draft, pinned: event.target.checked })}
            />
          </Row>
          <AdvancedSettings
            id="workspace-retention"
            title={t("Directory retention")}
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
            title={t("Storage limits")}
            defaultOpen={false}
          >
            <Row label={t("Directory budget (GiB)")}>
              <NumberField
                label={t("Directory budget (GiB)")}
                hideLabel
                aria-label={t("Directory budget (GiB)")}
                min={1}
                step={1}
                disabled={saving}
                value={draft.disk.budgetBytes / GIB || ""}
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
                label={t("Warn at (%)")}
                hideLabel
                aria-label={t("Warn at (%)")}
                min={1}
                max={100}
                step={1}
                disabled={saving}
                value={draft.disk.warningRatio * 100 || ""}
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
                label={t("Minimum free space (GiB)")}
                hideLabel
                aria-label={t("Minimum free space (GiB)")}
                min={0}
                step={1}
                disabled={saving}
                value={draft.disk.minimumFreeBytes / GIB}
                onChange={(event) =>
                  update({
                    ...draft,
                    disk: { ...draft.disk, minimumFreeBytes: event.target.valueAsNumber * GIB },
                  })
                }
              />
            </Row>
            {invalidDisk && (
              <SettingsFeedback state="error">
                {t(
                  "Enter a positive budget, a warning from 1 to 100%, and non-negative free space.",
                )}
              </SettingsFeedback>
            )}
          </AdvancedSettings>
          <div className="p-3">
            <Button variant="link" disabled={saving || loading} onClick={() => void save({})}>
              {t("Use Host defaults")}
            </Button>
          </div>
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
        <Group id="workspace-storage-status" title={t("Workspace storage")} layout="full">
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
              <span className="tabular-nums">{workspaceStorageSize(storage.sharedCacheBytes)}</span>
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
      {!!workspaces.length && (
        <section
          aria-label={t("Managed workspace directories")}
          className="flex min-w-0 flex-col gap-2"
        >
          <h3 className="text-ui-secondary font-medium">{t("Managed workspace directories")}</h3>
          {!capabilities?.includes(WORKSPACE_PINNING_CAPABILITY) && (
            <SettingsFeedback state="warning">
              {t("Update the execution Host to pin or unpin individual workspaces.")}
            </SettingsFeedback>
          )}
          <div
            role="list"
            className="divide-y divide-stroke rounded-xl border border-stroke bg-(--ui-surface)"
          >
            {workspaces.map((workspace) => (
              <div
                key={workspace.id}
                role="listitem"
                className="flex min-w-0 flex-wrap items-start gap-3 p-3"
              >
                <div className="min-w-0 flex-1 basis-60">
                  <p className="break-all text-ui-secondary">
                    {workspace.branchRef.replace(/^refs\/heads\//, "")}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-ui-caption text-(--ui-text-secondary)">
                    <span>{lifecycleLabel(workspace.state)}</span>
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
                      {t("Owner: {p0}", { p0: `${workspace.owner.kind} ${workspace.owner.id}` })}
                    </p>
                  </details>
                  {pinError?.id === workspace.id && (
                    <p role="alert" className="break-words text-ui-caption text-status-error">
                      {pinError.message}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  loading={pinning === workspace.id}
                  loadingLabel={t("Saving…")}
                  disabled={
                    !capabilities?.includes(WORKSPACE_PINNING_CAPABILITY) ||
                    loading ||
                    removing ||
                    (!!pinning && pinning !== workspace.id)
                  }
                  onClick={() => void pinWorkspace(workspace)}
                >
                  {workspace.pinned ? t("Unpin workspace") : t("Pin workspace")}
                </Button>
                {workspace.directoryState !== "removed" && (
                  <Button
                    variant="secondary"
                    disabled={
                      !capabilities?.includes("workspaces.lifecycle.v1") ||
                      workspace.state === "active" ||
                      removing ||
                      workspace.directoryState === "removing" ||
                      workspace.directoryState === "pendingRemoval"
                    }
                    onClick={() => setCleanup(workspace)}
                  >
                    {workspace.directoryState === "blocked"
                      ? t("Review blocked cleanup")
                      : t("Delete directory")}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      {cleanup && (
        <WorkspaceDirectoryRemoval
          workspace={cleanup}
          context={{ cwd, environmentId }}
          onClose={() => setCleanup(undefined)}
          onWorkspaceChange={(next) => {
            setWorkspaces((items) => items.map((item) => (item.id === next.id ? next : item)));
          }}
        />
      )}
    </div>
  );
}
