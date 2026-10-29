import { t } from "../../../shared/i18n/git";
import { confirmInApp } from "../../../shared/model/appConfirm";
import { basename, type GitChangedFile } from "../../../platform/tauri/fs";

export type GitConfirmation = {
  /** The decision, e.g. "Delete tag?". */
  title: string;
  /** Target and effect. */
  message: string;
  /** The real action, e.g. "Delete tag". */
  confirmLabel: string;
  /** `danger` (default) for anything that loses work or rewrites history. */
  tone?: "danger" | "normal";
};

/** One Git confirmation in the shared in-app dialog: Cancel is secondary, the action is explicit. */
export function confirmGitAction(confirmation: GitConfirmation): Promise<boolean> {
  return confirmInApp({ tone: "danger", ...confirmation });
}

const DESTRUCTIVE_LABEL = /delete|discard|remove|drop|reset|replace|amend|abort|undo|force|accept/i;

/**
 * Older call sites hand over one sentence ("Discard changes in a.ts? This cannot be undone.") and an
 * optional button label. The question becomes the title and the rest the effect; prefer `confirmGitAction`
 * with an explicit title when writing new code.
 */
export function confirmNative(message: string, okLabel?: string): Promise<boolean> {
  const split = /^(.+?\?)\s+([\s\S]+)$/.exec(message.trim());
  const title = split ? split[1] : okLabel ? t("{p0}?", { p0: okLabel }) : t("Are you sure?");
  return confirmGitAction({
    title,
    message: split ? split[2] : message,
    confirmLabel: okLabel ?? t("Continue"),
    tone: okLabel && !DESTRUCTIVE_LABEL.test(okLabel) ? "normal" : "danger",
  });
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
