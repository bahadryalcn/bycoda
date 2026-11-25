import { presentRemoteError } from "../../connections/public/remoteFailure";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Text } from "../../../shared/ui/Text";
import { useEffect, useState } from "react";
import { t, useLocale } from "../../../shared/i18n/git";
import { pathKey, prettyCwd, isEqualOrInside } from "../../../shared/lib/paths";
import { gitDiffIndex, type GitDiffIndex } from "../../../platform/tauri/fs";
import { Button } from "../../../shared/ui/Button";
import { ConfirmConsequences } from "../../../shared/ui/ConfirmDialog";
import { InlineError } from "../../../shared/ui/InlineError";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import {
  branchDeleteBlock,
  listWorktrees,
  type Worktree,
  type RemoveWorktree,
} from "../model/worktrees";
import { Checkbox } from "../../../shared/ui/Checkbox";
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
  const [branchConsent, setBranchConsent] = useState<{ path: string; branch: string }>();
  const tree = trees?.find((entry) => pathKey(entry.path) === pathKey(path));
  const deleteBranch =
    !!branchConsent && branchConsent.path === tree?.path && branchConsent.branch === tree.branch;
  if (branchConsent && !deleteBranch) setBranchConsent(undefined);
  const index = status?.path === tree?.path ? status?.value : undefined;

  // Reload the worktree inventory when the request changes or the owner retries.
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
        if (!cancelled) setError(presentRemoteError(reason, { explicit: true }));
      });
    return () => {
      cancelled = true;
    };
  }, [request, revision]);

  // Verify that the newly selected worktree is available and read its change counts.
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
          if (!cancelled) setError(presentRemoteError(reason, { explicit: true }));
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
  const blockedReason = busy
    ? undefined
    : (blocked ??
      (trees && !tree && !request.deletePath ? t("Select a worktree to delete.") : undefined));
  const remove = async () => {
    if (!tree || !ready || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const block = branchDeleteBlock(tree);
      if (deleteBranch && !block) {
        await onRemove(request.cwd, tree.path, true, true, undefined, true);
      } else {
        await onRemove(request.cwd, tree.path, true, true);
      }
      onClose();
    } catch (reason) {
      setError(presentRemoteError(reason, { explicit: true }));
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
        <ModalActions reason={blockedReason}>
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
        {(!trees && !error) || (tree && !tree.missing && !index && !error) ? (
          <GitLoading text={t("Loading worktrees…")} />
        ) : null}
        {trees && !trees.length ? (
          <EmptyState size="inline" kind="empty" description={t("No additional worktrees")} />
        ) : null}
        {trees && request.deletePath && !tree ? (
          <InlineError>{t("This worktree is no longer available.")}</InlineError>
        ) : null}
        {index && (tree?.dirty || tree?.unpushed || index.files.length > 0) ? (
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
        {tree && (tree.dirty || (index && index.files.length > 0)) ? (
          <ConfirmConsequences
            items={[
              {
                key: "discard",
                tone: "warning",
                content: t("All uncommitted and untracked changes here are discarded."),
              },
            ]}
          />
        ) : null}
        {tree?.branch ? (
          <Checkbox
            size="caption"
            label={t("Also delete branch {p0}", { p0: tree.branch })}
            description={
              branchDeleteBlock(tree) === "unpushed"
                ? t("It has unpushed commits.")
                : branchDeleteBlock(tree) === "default"
                  ? t("It is the default branch.")
                  : undefined
            }
            checked={deleteBranch && !branchDeleteBlock(tree)}
            disabled={busy || !!branchDeleteBlock(tree)}
            onChange={(event) =>
              setBranchConsent(
                event.target.checked && tree.branch
                  ? { path: tree.path, branch: tree.branch }
                  : undefined,
              )
            }
          />
        ) : null}
        {error ? (
          <GitFeedback
            detail={error}
            title={t("Couldn’t delete this worktree")}
            onRetry={!busy ? () => setRevision((value) => value + 1) : undefined}
          />
        ) : null}
      </Text>
    </Modal>
  );
}
