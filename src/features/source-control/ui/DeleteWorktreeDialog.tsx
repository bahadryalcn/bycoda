import { Switch } from "../../../shared/ui/Switch";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n/git";
import { useActionState, useState, type ComponentType, type ReactNode } from "react";
import { prettyCwd } from "../../../shared/lib/paths";
import { type Worktree } from "../model/worktrees";
import { Modal } from "../../../shared/ui/Modal";
import {
  CircleAlert,
  CloudUpload,
  FileDiff,
  Folder,
  GitBranch,
  Loader,
  MessageSquare,
} from "../../../shared/ui/icons";

const TONE = {
  danger: "text-danger",
  warn: "text-warning",
  muted: "text-[var(--ui-text-muted)]",
};

function Consequence({
  icon: Icon,
  tone = "muted",
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  tone?: keyof typeof TONE;
  children: ReactNode;
}) {
  useLocale();
  return (
    <li className="flex items-start gap-2.5">
      <Icon className={`mt-px icon-sm shrink-0 ${TONE[tone]}`} />
      <span className={`min-w-0 flex-1 ${tone === "muted" ? "" : TONE[tone]}`}>{children}</span>
    </li>
  );
}

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
  const [deleteSessions, setDeleteSessions] = useState(false);
  const [error, submit, busy] = useActionState<string | undefined, FormData>(async () => {
    try {
      // Confirmation covers the complete destructive action, including any
      // local changes that appeared after the last status refresh.
      await onRemove(cwd, tree.path, true, deleteSessions);
      onDeleted();
    } catch (e) {
      return String(e);
    }
  }, undefined);
  return (
    <Modal
      languageDomain="git"
      title={t("Delete worktree?")}
      size="sm"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="flex flex-col gap-3 p-4 text-ui-secondary leading-[1.5]" action={submit}>
        <p className="text-[var(--ui-text-secondary)]">
          {t("This permanently deletes the working copy and everything inside it.")}
        </p>
        <div>
          <p className="flex items-start gap-2.5 text-ui-caption text-[var(--ui-text-secondary)]">
            <Folder className="mt-px icon-sm shrink-0 text-[var(--ui-text-muted)]" />
            <span className="min-w-0 flex-1 break-all font-mono">{prettyCwd(tree.path)}</span>
          </p>
          <ul className="mt-2.5 flex flex-col gap-2 text-ui-caption text-[var(--ui-text-secondary)]">
            {sessionCount > 0 && (
              <Consequence icon={MessageSquare} tone={deleteSessions ? "danger" : "muted"}>
                {deleteSessions
                  ? t("Sessions using this worktree: {p0}. They will be permanently deleted.", {
                      p0: sessionCount,
                    })
                  : t(
                      "Sessions using this worktree: {p0}. They will be kept. Select a branch or worktree to continue them.",
                      { p0: sessionCount },
                    )}
              </Consequence>
            )}
            {tree.dirty && (
              <Consequence icon={FileDiff} tone="warn">
                {t("All uncommitted and untracked changes here are discarded.")}
              </Consequence>
            )}
            {tree.dirty == null && (
              <Consequence icon={CircleAlert} tone="warn">
                {t("Changes could not be checked. Anything uncommitted here is discarded.")}
              </Consequence>
            )}
            <Consequence icon={GitBranch}>
              {tree.branch ? (
                <>
                  <span className="font-medium text-content">{tree.branch}</span>
                  {t(" branch and its commits are kept.")}
                </>
              ) : (
                t("The branch is kept.")
              )}
            </Consequence>
            {!!tree.unpushed && (
              <Consequence icon={CloudUpload}>
                {tree.unpushed === 1
                  ? t("One commit has not been pushed. It stays on the branch.")
                  : t("{p0} commits have not been pushed. They stay on the branch.", {
                      p0: tree.unpushed,
                    })}
              </Consequence>
            )}
          </ul>
        </div>
        {sessionCount > 0 && (
          <div className="flex items-center justify-between gap-3">
            <span
              id="delete-worktree-sessions-label"
              className="text-ui-caption text-[var(--ui-text-secondary)]"
            >
              {t("Also delete associated sessions")}
            </span>
            <Switch
              aria-labelledby="delete-worktree-sessions-label"
              checked={deleteSessions}
              disabled={busy}
              onCheckedChange={setDeleteSessions}
            />
          </div>
        )}
        {error && (
          <p role="alert" className="break-words text-ui-caption text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" motion="none" type="button" disabled={busy} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            variant="danger"
            motion="none"
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1.5"
          >
            {busy && <Loader className="icon-sm animate-spin" />}
            {sessionCount && deleteSessions
              ? t(
                  sessionCount === 1
                    ? "Delete worktree and session"
                    : "Delete worktree and sessions",
                )
              : t("Delete worktree")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
