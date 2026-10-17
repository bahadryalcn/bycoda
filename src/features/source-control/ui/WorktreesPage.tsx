import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n/git";
import { useMemo, useState } from "react";
import { CreateWorktreeDialog } from "./CreateWorktreeDialog";
import { DeleteWorktreeDialog } from "./DeleteWorktreeDialog";
import { SearchableProjectPicker } from "../../projects/ui/SearchableProjectPicker";
import { AdvancedSettings } from "../../settings/ui/settingsControls";
import {
  FolderOpen,
  FolderTree,
  GitBranch,
  Loader,
  Plus,
  RefreshCw,
  Trash2,
} from "../../../shared/ui/icons";
import { revealPath } from "../../../platform/tauri/fs";
import { useProjectWorktrees } from "../hooks/useProjectWorktrees";
import { isEqualOrInside, pathKey, prettyCwd, projectName } from "../../../shared/lib/paths";
import { loadArchivedProjects, type RecentProject } from "../../projects/model/recents";
import type { Session } from "../../sessions/model/session";
import {
  checkWorktreeRemoval,
  worktreeSessionIds,
  type RemoveWorktree,
  type Worktree,
} from "../model/worktrees";

export function WorktreesPage({
  cwd,
  recents = [],
  liveSessions = [],
  onRemove,
  onCheckRemove = checkWorktreeRemoval,
  onDeleteSessions,
}: {
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
  const worktrees = data?.worktrees.filter((tree) => !tree.isMain) ?? [];
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Worktree>();
  const [refreshingAfterFailure, setRefreshingAfterFailure] = useState(false);
  return (
    <div
      data-setting-id="project-worktrees"
      id="setting-project-worktrees"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center gap-1">
        <SearchableProjectPicker
          cwd={project || "~"}
          recents={projects}
          className="w-fit max-w-full shrink-0"
          buttonClassName="max-w-full gap-2"
          onSelectProject={(path) => {
            setProject(path);
            setError(undefined);
            setDeleting(undefined);
          }}
        />
        <Button
          size="sm"
          variant="ghost"
          motion="none"
          type="button"
          disabled={!data}
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5"
        >
          <Plus className="size-3" />
          {t("Create worktree")}
        </Button>
      </div>
      <p className="break-all text-[12px] text-[var(--ui-text-secondary)]">
        {t("Scope: repository and machine of {p0}", { p0: prettyCwd(project || "~") })}
      </p>
      {!data ? (
        <p className="text-[12px] text-[var(--ui-text-secondary)]">
          {!project
            ? t("Select a project before creating a worktree.")
            : loadError
              ? t("Creation is unavailable until the repository loads. Refresh to retry.")
              : t("Creation becomes available after the repository loads.")}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-[12px] text-[var(--ui-text-secondary)]">
          {t(
            "Sessions can share a worktree. Deleting one keeps its sessions by default and discards uncommitted changes. Its branch and commits are kept.",
          )}
        </p>
        <Button
          size="sm"
          variant="ghost"
          motion="none"
          type="button"
          title={
            loadError
              ? t("Refresh failed: {p0}. Click to retry.", { p0: loadError })
              : t("Refresh worktrees")
          }
          aria-label={t("Refresh worktrees")}
          disabled={!project}
          onClick={refresh}
          className={"flex shrink-0 items-center gap-1.5"}
        >
          <RefreshCw className="size-3.5" />
          <span>{t("Refresh")}</span>
        </Button>
      </div>
      {error && (
        <p role="alert" className="break-words text-[12px] text-danger">
          {error}
        </p>
      )}
      {data && loadError ? (
        <p role="alert" className="break-words text-[12px] text-danger">
          {t("Refresh failed: {p0}. Click to retry.", { p0: loadError })}
        </p>
      ) : null}
      {refreshingAfterFailure ? (
        <p role="status" className="text-[12px] text-[var(--ui-text-secondary)]">
          {t("Refreshing after a failed deletion. Wait for current status before retrying.")}
        </p>
      ) : null}
      {!project ? (
        <p className="text-[12px] text-[var(--ui-text-secondary)]">
          {t("Add a project to manage its worktrees.")}
        </p>
      ) : !data && loadError ? (
        <p role="alert" className="break-words text-[12px] text-danger">
          {loadError}
        </p>
      ) : !data ? (
        <p className="flex items-center gap-2 text-[12px] text-[var(--ui-text-secondary)]">
          <Loader className="size-4 animate-spin" />
          {t("Loading worktrees…")}
        </p>
      ) : !worktrees.length ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-stroke px-4 py-8 text-center">
          <FolderTree className="size-5 text-[var(--ui-text-muted)]" />
          <p className="text-[13px] font-medium">{t("No additional worktrees")}</p>
          <p className="text-[12px] text-[var(--ui-text-secondary)]">
            {t("Create a worktree to work on another branch in a separate folder.")}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-stroke overflow-hidden rounded-xl border border-stroke">
          {worktrees.map((tree) => {
            const count = worktreeSessionIds(tree, liveSessions).length;
            const blocked = tree.locked
              ? t("Unlock this worktree in Git first")
              : !tree.branch
                ? t("Create a branch before deleting this detached worktree")
                : undefined;
            return (
              <div key={tree.path} className="flex items-start gap-3 p-4">
                <FolderTree className="mt-0.5 size-4 shrink-0 text-[var(--ui-text-muted)]" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium">{projectName(tree.path)}</span>
                    {pathKey(tree.path) === pathKey(project) && (
                      <span className="text-[10px] text-[var(--ui-text-muted)]">
                        {t("Selected project folder")}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 break-all text-[11px] text-[var(--ui-text-muted)]">
                    {prettyCwd(tree.path)}
                  </p>
                  {blocked || loadError || refreshingAfterFailure ? (
                    <p className="[margin-block-start:0.5rem] text-[11px] text-warning">
                      {blocked ??
                        (loadError
                          ? t("Deletion is unavailable until Refresh succeeds.")
                          : t("Deletion is unavailable while status is being refreshed."))}
                    </p>
                  ) : null}
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--ui-text-secondary)]">
                    <GitBranch className="size-3 shrink-0" />
                    <span className="min-w-0 break-all">
                      {tree.branch
                        ? t("Current branch: {p0}", { p0: tree.branch })
                        : t("Detached at {p0}", { p0: tree.head.slice(0, 7) })}
                    </span>
                  </p>
                  <p className="mt-2 flex flex-wrap gap-x-3 text-[11px] text-[var(--ui-text-secondary)]">
                    <span>
                      {count}
                      {t(" session")}
                      {count === 1 ? "" : "s"}
                      {t(" in this worktree")}
                    </span>
                    <span className={tree.dirty ? "text-warning" : ""}>
                      {tree.missing
                        ? t("Missing folder")
                        : tree.dirty == null
                          ? t("Status unavailable")
                          : tree.dirty
                            ? t("Uncommitted changes")
                            : t("Clean")}
                    </span>
                    {!!tree.unpushed && (
                      <span>
                        {tree.unpushed}
                        {t(" unpublished commit")}
                        {tree.unpushed === 1 ? "" : "s"}
                      </span>
                    )}
                    {tree.locked && <span>{t("Locked")}</span>}
                  </p>
                </div>
                <Button
                  size="sm"
                  iconOnly
                  label={t("Reveal {p0}", { p0: tree.branch ?? "worktree" })}
                  variant="ghost"
                  motion="none"
                  type="button"
                  disabled={tree.missing}
                  aria-label={t("Reveal {p0}", { p0: tree.branch ?? "worktree" })}
                  title={t("Reveal folder")}
                  onClick={() => void revealPath(tree.path).catch((e) => setError(String(e)))}
                >
                  <FolderOpen className="size-4" />
                </Button>
                <Button
                  size="sm"
                  iconOnly
                  label={t("Delete {p0}", { p0: tree.branch ?? "worktree" })}
                  variant="ghost"
                  motion="none"
                  type="button"
                  disabled={!!blocked || refreshingAfterFailure || !!loadError}
                  aria-label={t("Delete {p0}", { p0: tree.branch ?? "worktree" })}
                  title={blocked ?? t("Delete worktree")}
                  onClick={() => {
                    setError(undefined);
                    setDeleting(tree);
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
      {data && (
        <AdvancedSettings
          id="worktree-location"
          settingIds={["worktree-location"]}
          title={t("Advanced: worktree location and deletion")}
        >
          <p className="break-all py-3 text-[12px] text-[var(--ui-text-secondary)]">
            {t("New worktrees are created in ")}
            {prettyCwd(data.defaultRoot)}.
          </p>
          <p className="text-[12px] text-[var(--ui-text-secondary)]">
            {t(
              "The main working copy is excluded from this list. Deletion checks run before associated sessions can be removed. Review the confirmation for local changes and session retention.",
            )}
          </p>
        </AdvancedSettings>
      )}
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
            // Check predictable blockers before any conversation is destroyed.
            await onCheckRemove(cwd, path, force);
            const sessionIds = worktreeSessionIds(deleting, liveSessions);
            let sessionsDeleted = false;
            try {
              if (sessionIds.length && deleteSessions) {
                if (!onDeleteSessions) {
                  throw new Error("Sessions still use this worktree and could not be deleted.");
                }
                if (!(await onDeleteSessions(sessionIds))) {
                  throw new Error("Some sessions could not be deleted, so the worktree was kept.");
                }
                sessionsDeleted = true;
              }
              await onRemove(cwd, path, force, !deleteSessions);
            } catch (error) {
              const failure = sessionsDeleted
                ? new Error(
                    `The sessions were deleted, but the worktree was kept. ${String(error)}`,
                  )
                : error;
              // A partial deletion invalidates the dialog's saved session IDs.
              // Require a fresh listing before another destructive attempt.
              setDeleting(undefined);
              setError(String(failure));
              setRefreshingAfterFailure(true);
              await refresh();
              setRefreshingAfterFailure(false);
              throw failure;
            }
          }}
          onClose={() => setDeleting(undefined)}
          onDeleted={() => {
            if (isEqualOrInside(project, deleting.path)) {
              const main = data?.worktrees.find((tree) => tree.isMain);
              if (main) setProject(main.path);
            }
            setDeleting(undefined);
            refresh();
          }}
        />
      )}
    </div>
  );
}
