import { EmptyState } from "../../../shared/ui/EmptyState";
import { Text } from "../../../shared/ui/Text";
import { useEffect, useState } from "react";
import { t, useLocale } from "../../../shared/i18n/git";
import { pathKey, prettyCwd, isEqualOrInside } from "../../../shared/lib/paths";
import { gitDiffIndex, type GitDiffIndex } from "../../../platform/tauri/fs";
import { Button } from "../../../shared/ui/Button";
import { ConfirmConsequences } from "../../../shared/ui/ConfirmDialog";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { listWorktrees, type Worktree, type RemoveWorktree } from "../model/worktrees";
import type { WorktreeManagementRequest } from "../model/worktreeManagement";
import { GitFeedback, GitLoading } from "./GitFeedback";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";

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
  const remove = async () => {
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
  };
  return (
    <Modal
      languageDomain="git"
      title={t("Delete worktree?")}
      size="sm"
      initialFocus="[data-delete-worktree-cancel]"
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <ModalActions>
          <Button variant="ghost" data-delete-worktree-cancel="" disabled={busy} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            variant="primary"
            tone="danger"
            loading={busy}
            disabled={!ready || !!error}
            onClick={() => void remove()}
          >
            {t("Delete worktree")}
          </Button>
        </ModalActions>
      }
    >
      <Text as="div" size="caption" tone="inherit" className="flex min-w-0 flex-col gap-3">
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
          <Text as="p" size="inherit" tone="secondary" className="break-all">
            {tree.branch} · {prettyCwd(tree.path)}
          </Text>
        ) : null}
        {(!trees && !error) || (tree && !tree.missing && !index && !error) ? (
          <GitLoading text={t("Loading worktrees…")} />
        ) : null}
        {trees && !trees.length ? (
          <EmptyState size="inline" kind="empty" description={t("No additional worktrees")} />
        ) : null}
        {trees && request.deletePath && !tree ? (
          <InlineError>{t("This worktree is no longer available.")}</InlineError>
        ) : null}
        {index ? (
          <DescriptionList size="sm">
            <DescriptionItem term={t("Changes")}>
              {index.files.filter((file) => file.unstaged).length + (index.conflicts?.length ?? 0)}
            </DescriptionItem>
            <DescriptionItem term={t("Staged")}>
              {index.files.filter((file) => file.staged).length}
            </DescriptionItem>
            <DescriptionItem term={t("Unpushed commits")}>
              {tree?.unpushed ?? t("Status unavailable")}
            </DescriptionItem>
          </DescriptionList>
        ) : null}
        {tree ? (
          <ConfirmConsequences
            items={[
              {
                key: "discard",
                tone: "warning",
                content: t("All uncommitted and untracked changes here are discarded."),
              },
              { key: "branch", tone: "neutral", content: t("The branch is kept.") },
            ]}
          />
        ) : null}
        {blocked ? (
          <InlineMessage tone="warning" live="assertive">
            {blocked}
          </InlineMessage>
        ) : null}
        {error ? (
          <GitFeedback
            detail={error}
            title={t("Git operation failed")}
            onRetry={!busy ? () => setRevision((value) => value + 1) : undefined}
          />
        ) : null}
      </Text>
    </Modal>
  );
}
