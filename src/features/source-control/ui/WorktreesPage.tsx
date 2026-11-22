import { describeLocalError, presentRemoteError } from "../../connections/public/remoteFailure";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import styles from "./WorktreesPage.module.css";
import { t, useLocale } from "../../../shared/i18n/git";
import { useMemo, useRef, useState } from "react";
import { useRemoteSupports } from "../../connections/public/remoteCapabilities";
import { CreateWorktreeDialog } from "./CreateWorktreeDialog";
import { WorktreeRow } from "./WorktreeRow";
import { DeleteWorktreeDialog } from "./DeleteWorktreeDialog";
import { SearchableProjectPicker } from "../../projects/public/SearchableProjectPicker";
import { SettingsFeedback } from "../../../shared/ui/settings";
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
import {
  checkRemoteWorktreeRemoval,
  removeRemoteWorktree,
  reviewRemoteWorktreeRemoval,
  REMOTE_WORKTREE_REMOVAL,
  type RemoteWorktreeRemovalReview,
} from "../model/remoteWorktrees";
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
  const [remoteReview, setRemoteReview] = useState<{
    project: string;
    tree: Worktree;
    review: RemoteWorktreeRemovalReview;
  }>();
  const [reviewingProject, setReviewingProject] = useState<string>();
  const reviewRequest = useRef<object | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);
  const removals = useBackgroundRemovals();
  const [revealFailure, setRevealFailure] = useState<{
    path: string;
    message: string;
  }>();
  const remoteProject = project.startsWith(REMOTE_PATH_PREFIX);
  const remoteRemovalAvailable = useRemoteSupports(project, REMOTE_WORKTREE_REMOVAL) === true;
  const remoteLifecycleNotice = t(
    "Deleting worktrees runs on this computer, so it is unavailable for a project on a connected machine.",
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
                  setRemoteReview(undefined);
                  reviewRequest.current = undefined;
                  setReviewingProject(undefined);
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
                  disabled={!data}
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
                </Button>
              </div>
            </div>
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
                {t("New worktrees are created in {p0}", { p0: prettyCwd(data.defaultRoot) })}
              </Text>
            )}
            {remoteProject && !remoteRemovalAvailable && (
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
              <LoadingText delay={false} inset="row">
                {t("Loading worktrees…")}
              </LoadingText>
            )}
            {managedLoading && (
              <LoadingText delay={false} inset="row">
                {t("Loading managed workspaces…")}
              </LoadingText>
            )}
            {data && !worktrees.length && !managedWorkspaces?.length && (
              <EmptyState
                size="inline"
                inset="row"
                description={t("Create a worktree to work on another branch in a separate folder.")}
              />
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
                    ? !remoteRemovalAvailable
                      ? remoteLifecycleNotice
                      : reviewingProject === project
                        ? t("Wait for managed workspaces to load.")
                        : undefined
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
                      if (!remoteProject) {
                        setDeleting(tree);
                        return;
                      }
                      const request = {};
                      reviewRequest.current = request;
                      setReviewingProject(project);
                      void reviewRemoteWorktreeRemoval(project, tree.path)
                        .then(
                          (review) => {
                            if (reviewRequest.current !== request) return;
                            setRemoteReview({
                              project,
                              review,
                              tree: {
                                ...tree,
                                branch: review.branch,
                                head: review.head,
                                dirty: !!review.status,
                                unpushed: review.unpushed,
                              },
                            });
                          },
                          (failure) => {
                            if (reviewRequest.current === request)
                              setError(presentRemoteError(failure, { explicit: true }));
                          },
                        )
                        .finally(() => {
                          if (reviewRequest.current === request) setReviewingProject(undefined);
                        });
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
      {remoteReview?.project === project && (
        <DeleteWorktreeDialog
          cwd={project}
          tree={remoteReview.tree}
          sessionCount={remoteReview.review.sessionIds.length}
          ignoredEntryCount={remoteReview.review.ignoredEntryCount}
          ignoredEntryPaths={remoteReview.review.ignoredEntryPaths}
          onRemove={async (cwd, path, force, deleteSessions) => {
            checkRemoteWorktreeRemoval(remoteReview.review);
            try {
              await removeRemoteWorktree(
                cwd,
                path,
                remoteReview.review,
                force && !!(remoteReview.review.status || remoteReview.review.ignoredEntryCount),
                !deleteSessions,
              );
            } finally {
              await refresh();
            }
          }}
          onClose={() => setRemoteReview(undefined)}
          onDeleted={() => {
            setRemoteReview(undefined);
            if (isEqualOrInside(project, remoteReview.tree.path)) {
              const main = data?.worktrees.find((item) => item.isMain);
              if (main) setProject(main.path);
            }
          }}
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
                    throw new Error(
                      t("Sessions still use this worktree and could not be deleted."),
                    );
                  }
                  if (!(await onDeleteSessions(sessionIds))) {
                    throw new Error(
                      t("Some sessions could not be deleted, so the worktree was kept."),
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
                // The cause keeps the redaction and `Error:` stripping of describeLocalError.
                const failure = sessionsDeleted
                  ? new Error(
                      describeLocalError(
                        error,
                        t("The sessions were deleted, but the worktree was kept."),
                      ),
                    )
                  : error;
                setError(presentRemoteError(failure, { explicit: true }));
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
