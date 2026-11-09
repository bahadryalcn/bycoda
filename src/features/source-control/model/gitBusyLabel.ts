import { t } from "../../../shared/i18n/git";
import type { IndexAction } from "./optimisticIndex";

export const ACTION_LABEL: Record<IndexAction, string> = {
  get stage() {
    return t("Staging…");
  },
  get unstage() {
    return t("Unstaging…");
  },
  get discard() {
    return t("Discarding…");
  },
};

/** What the header says while `busy` is held and no step named itself. */
export function busyLabel(busy: string): string {
  if (busy === "commit") return t("Committing…");
  if (busy === "pr") return t("Creating pull request…");
  if (busy === "sync") return t("Syncing…");
  if (busy === "generate") return t("Generating message…");
  if (busy in ACTION_LABEL) return ACTION_LABEL[busy as IndexAction];
  return t("Working…");
}
