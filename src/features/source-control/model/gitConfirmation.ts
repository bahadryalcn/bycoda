import { t } from "../../../shared/i18n/git";
import { confirmInApp } from "../../../shared/model/appConfirm";
import { basename, type GitChangedFile } from "../../../platform/tauri/fs";

export type GitConfirmation = {
  /** The decision, e.g. "Delete tag?". */
  title: string;
  /** Consequences or target details the title does not already convey. */
  message?: string;
  /** The real action, e.g. "Delete tag". */
  confirmLabel: string;
  /** `danger` (default) for anything that loses work or rewrites history. */
  tone?: "danger" | "normal";
  /** Cancel wording; defaults to the Git-language "Cancel" so title and buttons share one language. */
  cancelLabel?: string;
};

/** One Git confirmation in the shared in-app dialog: Cancel is secondary, the action is explicit. */
export function confirmGitAction(confirmation: GitConfirmation): Promise<boolean> {
  const { message = "", ...action } = confirmation;
  return confirmInApp({ tone: "danger", cancelLabel: t("Cancel"), ...action, message });
}

export function confirmDiscardFile(file: GitChangedFile): Promise<boolean> {
  const name = basename(file.relative);
  if (file.status === "untracked") {
    return confirmGitAction({
      title: t("Delete untracked file?"),
      message: t("“{p0}” isn’t tracked by Git, so it can’t be recovered after deleting.", {
        p0: name,
      }),
      confirmLabel: t("Delete file"),
    });
  }
  return confirmGitAction({
    title: t("Discard changes?"),
    message: t("Your changes in “{p0}” will be discarded. This can’t be undone.", { p0: name }),
    confirmLabel: t("Discard changes"),
  });
}
