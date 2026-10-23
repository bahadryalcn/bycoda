import { useEffect, useState } from "react";
import { t, useLocale } from "../../../shared/i18n/git";
import { pathKey, prettyCwd, isEqualOrInside } from "../../../shared/lib/paths";
import { gitDiffIndex, type GitDiffIndex } from "../../../platform/tauri/fs";
import { Button } from "../../../shared/ui/Button";
import { Modal } from "../../../shared/ui/Modal";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { listWorktrees, type Worktree, type RemoveWorktree } from "../model/worktrees";
import type { WorktreeManagementRequest } from "../model/worktreeManagement";
import { GitFeedback, GitLoading } from "./GitFeedback";

/** A checkout-scoped confirmation; removal stays owned by the app and keeps sessions. */
export function QuickDeleteWorktreeDialog({
  request,
  onRemove,
  onClose,
}: {
  request: WorktreeManagementRequest;
  onRemove: RemoveWorktree;
  onClose: () => void;
}) {
  useLocale();
  const [trees, setTrees] = useState<Worktree[]>();
  const [path, setPath] = useState(request.deletePath ?? "");
  const [status, setStatus] = useState<{ path: string; value: GitDiffIndex }>();
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const tree = trees?.find((entry) => pathKey(entry.path) === pathKey(path));
  const index = status?.path === tree?.path ? status?.value : undefined;

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    setTrees(undefined);
    void listWorktrees(request.cwd)
      .then((data) => {
        if (cancelled) return;
        const linked = data.worktrees.filter((entry) => !entry.isMain);
        setTrees(linked);
        if (!request.deletePath) {
          setPath(linked.find((entry) => isEqualOrInside(request.cwd, entry.path))?.path ?? "");
        }
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [request, revision]);

  useEffect(() => {
    let cancelled = false;
    setStatus(undefined);
    setError(undefined);
    if (tree && !tree.missing) {
      void gitDiffIndex(tree.path)
        .then((value) => {
          if (cancelled) return;
          if (value.repository === false) {
            setError(t("This worktree is no longer available."));
            return;
          }
          setStatus({ path: tree.path, value });
        })
        .catch((reason) => {
          if (!cancelled) setError(String(reason));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [tree, revision]);

  const blocked = tree?.locked
    ? t("Unlock this worktree in Git first")
    : tree && !tree.branch
      ? t("Create a branch before deleting this detached worktree")
      : undefined;
  const ready = !!tree && !blocked && (!!index || tree.missing);
  return (
    <Modal
      languageDomain="git"
      title={t("Delete worktree?")}
      size="sm"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="flex min-w-0 flex-col gap-3 p-4 text-ui-caption">
        {!request.deletePath && trees ? (
          <SearchableSelect
            label={t("Worktree")}
            value={path}
            disabled={busy}
            options={[
              { value: "", label: t("Select a worktree") },
              ...trees.map((entry) => ({
                value: entry.path,
                label: entry.branch ?? prettyCwd(entry.path),
                keywords: entry.path,
              })),
            ]}
            onChange={setPath}
          />
        ) : null}
        {tree ? (
          <p className="break-all text-(--ui-text-secondary)">
            {tree.branch} · {prettyCwd(tree.path)}
          </p>
        ) : null}
        {(!trees && !error) || (tree && !tree.missing && !index && !error) ? (
          <GitLoading text={t("Loading worktrees…")} />
        ) : null}
        {trees && !trees.length ? <p>{t("No additional worktrees")}</p> : null}
        {trees && request.deletePath && !tree ? (
          <p role="alert">{t("This worktree is no longer available.")}</p>
        ) : null}
        {index ? (
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
            <dt>{t("Changes")}</dt>
            <dd>
              {index.files.filter((file) => file.unstaged).length + (index.conflicts?.length ?? 0)}
            </dd>
            <dt>{t("Staged")}</dt>
            <dd>{index.files.filter((file) => file.staged).length}</dd>
            <dt>{t("Unpushed commits")}</dt>
            <dd>{tree?.unpushed ?? t("Status unavailable")}</dd>
          </dl>
        ) : null}
        {tree ? (
          <p className="text-warning">
            {t("All uncommitted and untracked changes here are discarded.")}{" "}
            {t("The branch is kept.")}
          </p>
        ) : null}
        {blocked ? (
          <p role="alert" className="text-warning">
            {blocked}
          </p>
        ) : null}
        {error ? (
          <GitFeedback
            detail={error}
            title={t("Git operation failed")}
            onRetry={!busy ? () => setRevision((value) => value + 1) : undefined}
          />
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={!ready || !!error}
            onClick={async () => {
              if (!tree || !ready || busy) return;
              setBusy(true);
              setError(undefined);
              try {
                await onRemove(request.cwd, tree.path, true, true);
                onClose();
              } catch (reason) {
                setError(String(reason));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("Delete worktree")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
