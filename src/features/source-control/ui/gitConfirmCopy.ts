import { t } from "../../../shared/i18n/git";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import type { GitConfirmation } from "../model/gitConfirmation";

/** Confirmation copy for destructive Git panel actions, ready for `confirmGitAction`. */
export function discardSelectedCopy(count: number): GitConfirmation {
  return {
    title: t("Discard changes in {p0} selected files?", { p0: count }),
    message: t("Untracked files will be deleted. This cannot be undone."),
    confirmLabel: t("Discard"),
  };
}

export function discardUnstagedCopy(
  count: number,
  onlyName: string | undefined,
  untrackedOnly: boolean,
): GitConfirmation {
  const message = t("This cannot be undone.");
  if (untrackedOnly) {
    return {
      title: t("Delete untracked file {p0}?", { p0: onlyName }),
      message,
      confirmLabel: t("Delete"),
    };
  }
  return {
    title:
      count === 1 && onlyName
        ? t("Discard changes in {p0}?", { p0: onlyName })
        : t("Discard all unstaged changes in {p0} files?", { p0: count }),
    message,
    confirmLabel: t("Discard"),
  };
}

export function amendPushedCopy(): GitConfirmation {
  return {
    title: t("Amend a commit that is already pushed?"),
    message: t("{p0} cannot push the result. You will need a force push from the terminal.", {
      p0: PRODUCT_IDENTITY.displayName,
    }),
    confirmLabel: t("Amend"),
  };
}

export function trustRepositoryCopy(cwd: string): GitConfirmation {
  return {
    title: t("Trust Git repository at {p0}?", { p0: cwd }),
    message: t("This adds only this path to Git safe.directory."),
    confirmLabel: t("Trust this repository"),
    tone: "normal",
  };
}

export function defaultBranchCopy(kind: "push" | "pr", branch: string): GitConfirmation {
  return {
    title:
      kind === "pr"
        ? t('Create a pull request from default branch "{p0}"?', { p0: branch })
        : t('Push to default branch "{p0}"?', { p0: branch }),
    message: t("The default branch is shared with everyone on this repository."),
    confirmLabel: kind === "pr" ? t("Create pull request") : t("Push"),
    tone: "normal",
  };
}

export function discardConflictCopy(): GitConfirmation {
  return {
    title: t("Discard the unsaved conflict resolution?"),
    message: t("Your edits to this conflict will be lost."),
    confirmLabel: t("Discard"),
  };
}

export function deleteRemoteBranchCopy(ref: string): GitConfirmation {
  return {
    title: t("Delete {p0} from the remote?", { p0: ref }),
    message: t("The branch is removed for everyone who uses this remote."),
    confirmLabel: t("Delete"),
  };
}
