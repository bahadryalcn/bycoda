import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import styles from "./WorktreesPage.module.css";
import { t, useLocale } from "../../../shared/i18n/git";
import { useMemo, useState } from "react";
import { CreateWorktreeDialog } from "./CreateWorktreeDialog";
import { WorktreeRow } from "./WorktreeRow";
import { DeleteWorktreeDialog } from "./DeleteWorktreeDialog";
import { SearchableProjectPicker } from "../../projects/public/SearchableProjectPicker";
import { SettingsFeedback } from "../../settings/public/settingsControls";
import { Heading } from "../../../shared/ui/Heading";
import { Plus, RefreshCw } from "../../../shared/ui/icons";
import { revealPath } from "../../../platform/tauri/fs";
import { useProjectWorktrees } from "../hooks/useProjectWorktrees";
import { isEqualOrInside, pathKey, prettyCwd, projectName } from "../../../shared/lib/paths";
import { REMOTE_PATH_PREFIX } from "../../../shared/lib/remotePaths";
import { loadArchivedProjects, type RecentProject } from "../../projects/public/recents";

import type { Session } from "../../sessions";
import {
  checkWorktreeRemoval,
  worktreeSessionIds,
  type RemoveWorktree,
  type Worktree,
} from "../model/worktrees";
import { WorkspacePolicySettings } from "../../workspaces/ui/WorkspacePolicySettings";
import type { ManagedWorkspace } from "../../workspaces/model/contracts";
import {
  isBackgroundRemoval,
  runBackgroundRemoval,
  useBackgroundRemovals,
} from "../../workspaces/public/backgroundRemoval";

export function WorktreesPage({
  cwd,
  recents = [],
  liveSessions = [],
  onRemove,
  onCheckRemove = checkWorktreeRemoval,
  onDeleteSessions,
  boundary = false,
}: {
  /** Names the selected-repository task boundary when the page sits below global Git preferences. */
  boundary?: boolean;
  cwd: string;
  recents?: RecentProject[];
  liveSessions?: Session[];
  onRemove: RemoveWorktree;
  onCheckRemove?: RemoveWorktree;
  onDeleteSessions?: (sessionIds: readonly string[]) => Promise<boolean>;
}) {
  useLocale();
  const projects = useMemo(() => {
    const choices: RecentProject[] = [];
    const seen = new Set<string>();
    const add = (choice: RecentProject) => {
      if (!choice.path || choice.path === "~") return;
      const key = pathKey(choice.path);
      if (seen.has(key)) return;
      seen.add(key);
      choices.push(choice);
    };
    add({ path: cwd, openedAt: Number.MAX_SAFE_INTEGER });
    recents.forEach(add);
    loadArchivedProjects().forEach((item) => add({ path: item.path, openedAt: item.archivedAt }));
    return choices;
  }, [cwd, recents]);
  const [project, setProject] = useState(cwd === "~" ? (projects[0]?.path ?? "") : cwd);
  const { data, error: loadError, refresh } = useProjectWorktrees(project);
  const rawWorktrees = data?.worktrees.filter((tree) => !tree.isMain) ?? [];
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Worktree>();
  const [refreshing, setRefreshing] = useState(false);
  const removals = useBackgroundRemovals();
  const [revealFailure, setRevealFailure] = useState<{
    path: string;
    message: string;
  }>();
  // Create, remove and preflight dispatch to this computer; only listing and Reveal
  // follow a connected machine's path. Keep those actions off for remote projects.
  const remoteProject = project.startsWith(REMOTE_PATH_PREFIX);
  const remoteLifecycleNotice = t(
    "Creating and deleting worktrees runs on this computer, so it is unavailable for a project on a connected machine.",
  );
  const [managedWorkspaces, setManagedWorkspaces] = useState<ManagedWorkspace[] | null>(null);
  const [managedLoading, setManagedLoading] = useState(true);
  const managedPaths = new Set(managedWorkspaces?.map((workspace) => pathKey(workspace.path)));
  const worktrees = rawWorktrees.filter((tree) => !managedPaths.has(pathKey(tree.path)));
  const revealWorktree = (path: string) => {
    setRevealFailure(undefined);
    void revealPath(path).catch((failure) => setRevealFailure({ path, message: String(failure) }));
  };
  return (
    <div
      data-setting-id="project-worktrees"
      id="setting-project-worktrees"
      className={`${styles.page} settings-topics`}
    >
      <WorkspacePolicySettings
        key={project}
        cwd={project}
        onInventory={(inventory) => {
          setManagedLoading(inventory === null);
          if (inventory !== null) setManagedWorkspaces(inventory);
        }}
        renderHeader={(refreshManaged, managedBusy, managedDisabled) => (
          <header className={styles.header}>
            {boundary && <Heading size="section">{t("Worktrees")}</Heading>}
            <div className={styles.toolbar}>
              <SearchableProjectPicker
                cwd={project || "~"}
                recents={projects}
                className="w-fit max-w-full shrink-0"
                buttonClassName="max-w-full gap-2"
                onSelectProject={(path) => {
                  setProject(path);
                  setError(undefined);
                  setDeleting(undefined);
                  setRevealFailure(undefined);
                  setManagedWorkspaces(null);
                  setManagedLoading(true);
                }}
              />
              <div className={styles.actions}>
                <Button
                  size="sm"
                  variant="secondary"
                  motion="none"
                  type="button"
                  disabled={!data || remoteProject}
                  tooltip={remoteProject ? remoteLifecycleNotice : undefined}
                  onClick={() => setCreating(true)}
                  className="flex items-center gap-1.5"
                >
                  <Plus className="icon-xs" />
                  {t("Create worktree")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  motion="none"
                  type="button"
                  iconOnly
                  label={t("Refresh worktrees")}
                  tooltip={
                    loadError
                      ? t("Refresh failed: {p0}. Click to retry.", {
                          p0: loadError,
                        })
                      : undefined
                  }
                  disabled={!project || managedDisabled}
                  loading={refreshing || managedBusy || (!!project && !data && !loadError)}
                  loadingLabel={t("Refreshing…")}
                  onClick={async () => {
                    setRefreshing(true);
                    try {
                      await Promise.all([refresh(), refreshManaged()]);
                    } finally {
                      setRefreshing(false);
                    }
                  }}
                >
                  <RefreshCw className="icon-sm" />
                  <span className="sr-only">{t("Refresh")}</span>
                </Button>
              </div>
            </div>
            <Text as="p" size="caption" tone="muted" leading="inherit" className={styles.scope}>
              {prettyCwd(project || "~")}
            </Text>
            {data && (
              <Text
                as="p"
                size="caption"
                tone="secondary"
                leading="inherit"
                id="setting-worktree-location"
                data-setting-id="worktree-location"
                className={styles.location}
              >
                {t("New worktrees are created in ")}{" "}
                <Text size="inherit" tone="muted">
                  {prettyCwd(data.defaultRoot)}
                </Text>
              </Text>
            )}
            {remoteProject && (
              <Text as="p" size="inherit" tone="secondary">
                {remoteLifecycleNotice}
              </Text>
            )}
          </header>
        )}
        liveSessions={liveSessions}
        policyCollapsed={!boundary}
        hasWorktreeMatches={(query) =>
          !data ||
          managedLoading ||
          !!error ||
          !!loadError ||
          worktrees.some((tree) =>
            `${tree.path} ${tree.branch ?? tree.head}`
              .toLocaleLowerCase()
              .includes(query.trim().toLocaleLowerCase()),
          ) ||
          !query.trim()
        }
        renderWorktrees={(query) => (
          <>
            {error && <SettingsFeedback state="error">{error}</SettingsFeedback>}
            {loadError && <SettingsFeedback state="error">{loadError}</SettingsFeedback>}
            {!data && !loadError && (
              <Text as="p" size="inherit" tone="secondary" role="status" className={styles.empty}>
                {t("Loading worktrees…")}
              </Text>
            )}
            {managedLoading && (
              <Text as="p" size="inherit" tone="secondary" role="status" className={styles.empty}>
                {t(
                  "Managed workspaces are loading. Deletion is unavailable until their status is known.",
                )}
              </Text>
            )}
            {data && !worktrees.length && !managedWorkspaces?.length && (
              <Text as="p" size="inherit" tone="secondary" className={styles.empty}>
                {t("Create a worktree to work on another branch in a separate folder.")}
              </Text>
            )}
            {worktrees
              .filter((tree) =>
                `${tree.path} ${tree.branch ?? tree.head}`
                  .toLocaleLowerCase()
                  .includes(query.trim().toLocaleLowerCase()),
              )
              .map((tree) => {
                const count = worktreeSessionIds(tree, liveSessions).length;
                const folderName = projectName(tree.path);
                const identityHint =
                  liveSessions.find((session) =>
                    worktreeSessionIds(tree, liveSessions).includes(session.id),
                  )?.title ||
                  tree.branch ||
                  folderName;
                const blocked = tree.locked
                  ? t("Unlock this worktree in Git first")
                  : !tree.branch
                    ? t("Create a branch before deleting this detached worktree")
                    : undefined;
                const warning =
                  blocked ??
                  (loadError ? t("Deletion is unavailable until Refresh succeeds.") : undefined);
                const deleteDisabledReason =
                  warning ??
                  (remoteProject
                    ? remoteLifecycleNotice
                    : managedLoading
                      ? t("Wait for managed workspaces to load.")
                      : undefined);
                return (
                  <WorktreeRow
                    key={tree.path}
                    tree={tree}
                    selected={pathKey(tree.path) === pathKey(project)}
                    sessionCount={count}
                    identityHint={identityHint}
                    warning={warning}
                    revealError={
                      revealFailure?.path === tree.path
                        ? t("Couldn't reveal this folder: {p0}", { p0: revealFailure.message })
                        : undefined
                    }
                    deleteDisabledReason={deleteDisabledReason}
                    removing={isBackgroundRemoval(removals, tree.path)}
                    onReveal={() => revealWorktree(tree.path)}
                    onDelete={() => {
                      setError(undefined);
                      setDeleting(tree);
                    }}
                  />
                );
              })}
          </>
        )}
      />
      {creating && (
        <CreateWorktreeDialog
          cwd={project}
          baseCwd={project}
          defaultRoot={data?.defaultRoot}
          onCreated={() => {
            setCreating(false);
            refresh();
          }}
          onCancel={() => setCreating(false)}
        />
      )}
      {deleting && (
        <DeleteWorktreeDialog
          cwd={project}
          tree={deleting}
          sessionCount={worktreeSessionIds(deleting, liveSessions).length}
          onRemove={async (cwd, path, force, deleteSessions) => {
            // Check predictable blockers before the dialog closes; nothing is destroyed yet.
            await onCheckRemove(cwd, path, force);
            const tree = deleting;
            const sessionIds = worktreeSessionIds(tree, liveSessions);
            void runBackgroundRemoval(path, tree.branch ?? projectName(path), async () => {
              let sessionsDeleted = false;
              try {
                if (sessionIds.length && deleteSessions) {
                  if (!onDeleteSessions) {
                    throw new Error("Sessions still use this worktree and could not be deleted.");
                  }
                  if (!(await onDeleteSessions(sessionIds))) {
                    throw new Error(
                      "Some sessions could not be deleted, so the worktree was kept.",
                    );
                  }
                  sessionsDeleted = true;
                }
                await onRemove(cwd, path, force, !deleteSessions);
                if (isEqualOrInside(project, path)) {
                  const main = data?.worktrees.find((item) => item.isMain);
                  if (main) setProject(main.path);
                }
              } catch (error) {
                const failure = sessionsDeleted
                  ? new Error(
                      `The sessions were deleted, but the worktree was kept. ${String(error)}`,
                    )
                  : error;
                setError(String(failure));
                throw failure;
              } finally {
                // The row stays blocked until a fresh listing replaces its saved session IDs.
                await refresh().catch(() => false);
              }
            });
          }}
          onClose={() => setDeleting(undefined)}
          onDeleted={() => setDeleting(undefined)}
        />
      )}
    </div>
  );
}
