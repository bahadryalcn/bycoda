import { t, useLocale } from "../../../shared/i18n/git";
import { prettyCwd } from "../../../shared/lib/paths";
import { type Worktree } from "../model/worktrees";
import { ConfirmDialog, type ConfirmState } from "../../../shared/ui/ConfirmDialog";
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
  onRemove,
  onClose,
  onDeleted,
}: {
  cwd: string;
  tree: Worktree;
  sessionCount?: number;
  onRemove: (cwd: string, path: string, force: boolean, deleteSessions: boolean) => Promise<void>;
  onClose: () => void;
  onDeleted: () => void;
}) {
  useLocale();
  return (
    <ConfirmDialog
      onSettle={(confirmed) => (confirmed ? onDeleted() : onClose())}
      request={{
        title: t("Delete worktree?"),
        message: t("This permanently deletes the working copy and everything inside it."),
        cancelLabel: t("Cancel"),
        details: (
          <p className="flex items-start gap-2 text-ui-caption text-(--ui-text-secondary)">
            <span className="flex h-(--ui-leading-caption) shrink-0 items-center text-(--ui-text-muted)">
              <Folder className="icon-sm" />
            </span>
            <span className="min-w-0 flex-1 break-all font-mono">{prettyCwd(tree.path)}</span>
          </p>
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
                <span className="font-medium text-content">{tree.branch}</span>
                {t(" branch and its commits are kept.")}
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
        acknowledge:
          sessionCount > 0
            ? { label: t("Also delete associated sessions"), control: "switch" }
            : undefined,
        // Confirmation covers the complete destructive action, including any
        // local changes that appeared after the last status refresh.
        onConfirm: ({ acknowledged }) => onRemove(cwd, tree.path, true, acknowledged),
      }}
    />
  );
}
