import { Text } from "../../../shared/ui/Text";
import { t, useLocale } from "../../../shared/i18n/git";
import { prettyCwd } from "../../../shared/lib/paths";
import { branchDeleteBlock, type Worktree } from "../model/worktrees";
import { Checkbox } from "../../../shared/ui/Checkbox";
import {
  useConfirm,
  type ConfirmRequest,
  type ConfirmState,
} from "../../../shared/ui/ConfirmDialog";
import { useEffect, useRef, useState } from "react";
import {
  CircleAlert,
  CloudUpload,
  FileDiff,
  Folder,
  GitBranch,
  MessageSquare,
} from "../../../shared/ui/icons";

export function DeleteWorktreeDialog({
  cwd,
  tree,
  sessionCount = 0,
  ignoredEntryCount = 0,
  ignoredEntryPaths,
  onRemove,
  onClose,
  onDeleted,
}: {
  cwd: string;
  tree: Worktree;
  sessionCount?: number;
  ignoredEntryCount?: number;
  ignoredEntryPaths?: readonly string[];
  onRemove: (
    cwd: string,
    path: string,
    force: boolean,
    deleteSessions: boolean,
    deleteBranch?: boolean,
  ) => Promise<void>;
  onClose: () => void;
  onDeleted: () => void;
}) {
  useLocale();
  const { confirmWith, renderDialog } = useConfirm();
  const callbacks = useRef({ onClose, onDeleted });
  const started = useRef(false);
  const block = branchDeleteBlock(tree);
  const [deleteBranch, setDeleteBranch] = useState(false);
  const wantsBranchDelete = deleteBranch && !!tree.branch && !block;
  const branchDeleteRef = useRef(false);
  branchDeleteRef.current = wantsBranchDelete;
  callbacks.current = { onClose, onDeleted };
  const request: ConfirmRequest = {
    title: t("Delete worktree?"),
    message: t("This permanently deletes the worktree and everything inside it."),
    cancelLabel: t("Cancel"),
    details: (
      <Text as="p" size="caption" tone="secondary" className="flex items-start gap-2">
        <Text
          size="inherit"
          tone="muted"
          className="flex h-(--ui-leading-caption) shrink-0 items-center"
        >
          <Folder className="icon-sm" />
        </Text>
        <span className="min-w-0 flex-1 break-all font-mono">{prettyCwd(tree.path)}</span>
      </Text>
    ),
    confirmLabel: ({ acknowledged }: ConfirmState) =>
      sessionCount && acknowledged
        ? t(sessionCount === 1 ? "Delete worktree and session" : "Delete worktree and sessions")
        : t("Delete worktree"),
    consequences: ({ acknowledged }: ConfirmState) => [
      sessionCount > 0 && {
        key: "sessions",
        icon: MessageSquare,
        tone: acknowledged ? "danger" : "neutral",
        content: acknowledged
          ? t("Sessions using this worktree: {p0}. They will be permanently deleted.", {
              p0: sessionCount,
            })
          : t(
              "Sessions using this worktree: {p0}. They will be kept. Select a branch or worktree to continue them.",
              { p0: sessionCount },
            ),
      },
      tree.dirty && {
        key: "dirty",
        icon: FileDiff,
        tone: "warning",
        content: t("All uncommitted and untracked changes here are discarded."),
      },
      ignoredEntryCount > 0 && {
        key: "ignored",
        icon: CircleAlert,
        tone: "warning",
        content: (
          <>
            {t("Ignored entries that will be deleted: {p0}", { p0: ignoredEntryCount })}
            {ignoredEntryPaths?.map((path) => (
              <span key={path} className="block break-all font-mono">
                {path}
              </span>
            ))}
          </>
        ),
      },
      tree.dirty == null && {
        key: "unchecked",
        icon: CircleAlert,
        tone: "warning",
        content: t("Changes could not be checked. Anything uncommitted here is discarded."),
      },
      {
        key: "branch",
        icon: GitBranch,
        tone: "neutral",
        content: tree.branch ? (
          <>
            <Text size="inherit" tone="primary" weight="medium">
              {tree.branch}
            </Text>
            {wantsBranchDelete
              ? t(" branch is deleted if it is fully merged.")
              : t(" branch and its commits are kept.")}
          </>
        ) : (
          t("The branch is kept.")
        ),
      },
      !!tree.unpushed && {
        key: "unpushed",
        icon: CloudUpload,
        tone: "neutral",
        content:
          tree.unpushed === 1
            ? t("One commit has not been pushed. It stays on the branch.")
            : t("{p0} commits have not been pushed. They stay on the branch.", {
                p0: tree.unpushed,
              }),
      },
    ],
    body: tree.branch ? (
      <Checkbox
        size="caption"
        label={t("Also delete branch {p0}", { p0: tree.branch })}
        description={
          block === "unpushed"
            ? t("It has unpushed commits.")
            : block === "default"
              ? t("It is the default branch.")
              : undefined
        }
        checked={wantsBranchDelete}
        disabled={!!block}
        onChange={(event) => setDeleteBranch(event.target.checked)}
      />
    ) : undefined,
    acknowledge:
      sessionCount > 0
        ? { label: t("Also delete associated sessions"), control: "switch" as const }
        : undefined,
    // Confirmation covers the complete destructive action, including changes
    // that appeared after the last status refresh.
    onConfirm: ({ acknowledged }) =>
      branchDeleteRef.current
        ? onRemove(cwd, tree.path, true, acknowledged, true)
        : onRemove(cwd, tree.path, true, acknowledged),
  };
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void confirmWith(request).then(
      (result) => {
        if (result) callbacks.current.onDeleted();
        else callbacks.current.onClose();
      },
      (error: unknown) => {
        console.error("Delete worktree confirmation failed", error);
        callbacks.current.onClose();
      },
    );
    // The dialog is opened once; renderDialog below supplies live request data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return renderDialog(request);
}
