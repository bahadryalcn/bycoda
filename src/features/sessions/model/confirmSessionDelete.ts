import { t } from "../../../shared/i18n";
import { confirmInApp, type AppConfirmRequest } from "../../../shared/model/appConfirm";
import { bulkDeleteConfirmMessage } from "./bulkSessionDelete";

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
const shortTitle = (title: string) =>
  title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1)}…` : title;

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

/** Reads a count out of an older plain-text question so callers that still pass one get the new dialog. */
function legacyConfirmation(message: string): SessionDeleteConfirmation {
  const count = Number(/Delete (\d+)/.exec(message)?.[1] ?? 1);
  const skipped = Number(/(\d+) running conversations? will be skipped/.exec(message)?.[1] ?? 0);
  return { count, skippedRunning: skipped };
}

/**
 * Resolves true only when the owner confirms. Escape, Cancel and closing resolve false. The caller
 * deletes after this resolves and reports progress, partial failure and retry on its own surface.
 */
export function confirmSessionDelete(input: string | SessionDeleteConfirmation): Promise<boolean> {
  const confirmation = typeof input === "string" ? legacyConfirmation(input) : input;
  return confirmInApp({
    ...sessionDeleteRequest(confirmation),
    // Without the in-app host (web preview, tests) the platform dialog keeps the plain question.
    fallbackText:
      typeof input === "string"
        ? input
        : bulkDeleteConfirmMessage(confirmation.count, confirmation.skippedRunning ?? 0),
  });
}
