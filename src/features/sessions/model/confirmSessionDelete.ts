import { t } from "../../../shared/i18n";
import { confirmInApp, type AppConfirmRequest } from "../../../shared/model/appConfirm";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";

/** What a deletion is about to remove; the wording is derived from it, never from the caller. */
export type SessionDeleteConfirmation = {
  /** Conversations that will be deleted. */
  count: number;
  /** Name of the conversation when exactly one is targeted. */
  title?: string;
  /** Running conversations that are skipped and stay. */
  skippedRunning?: number;
};

const MAX_TITLE = 80;
const shortTitle = (title: string) => truncateGraphemes(title, MAX_TITLE);

/** Singular/plural title, target and accurate effect for the shared dialog. */
export function sessionDeleteRequest(confirmation: SessionDeleteConfirmation): AppConfirmRequest {
  const count = Math.max(1, confirmation.count);
  const plural = count !== 1;
  const name = confirmation.title?.trim();
  const effect = plural
    ? t("{p0} conversations and their history will be permanently deleted. This can’t be undone.", {
        p0: count,
      })
    : name
      ? t("“{p0}” and its history will be permanently deleted. This can’t be undone.", {
          p0: shortTitle(name),
        })
      : t("This conversation and its history will be permanently deleted. This can’t be undone.");
  const skipped = confirmation.skippedRunning ?? 0;
  const note =
    skipped > 0
      ? skipped === 1
        ? t("1 running conversation will be skipped.")
        : t("{p0} running conversations will be skipped.", { p0: skipped })
      : "";
  return {
    title: plural ? t("Delete {p0} conversations?", { p0: count }) : t("Delete conversation?"),
    message: note ? `${effect} ${note}` : effect,
    confirmLabel: plural ? t("Delete {p0} conversations", { p0: count }) : t("Delete"),
    tone: "danger",
  };
}

/**
 * Resolves true only when the owner confirms. Escape, Cancel and closing resolve false. The caller
 * deletes after this resolves and reports progress, partial failure and retry on its own surface.
 */
export function confirmSessionDelete(confirmation: SessionDeleteConfirmation): Promise<boolean> {
  const request = sessionDeleteRequest(confirmation);
  return confirmInApp({
    ...request,
    // Plain-text wording for a surface that cannot show the in-app dialog; built from the same translated copy.
    fallbackText: `${request.title}\n\n${request.message}`,
  });
}
