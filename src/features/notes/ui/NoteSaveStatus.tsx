import { t, useLocale } from "../../../shared/i18n";

/** One save/recovery vocabulary for the library editor and the session note panel. */
export type NoteSaveState =
  | "deleting"
  | "failed"
  | "attention"
  | "conflict"
  | "recovering"
  | "saving"
  | "unsaved"
  | "saved";

const LABELS: Record<NoteSaveState, string> = {
  deleting: "Deleting…",
  failed: "Save failed",
  attention: "Title needs attention",
  conflict: "Changed elsewhere",
  recovering: "Saving recovery copy…",
  saving: "Saving…",
  unsaved: "Unsaved changes",
  saved: "Saved",
};

export function NoteSaveStatus({ state, className }: { state: NoteSaveState; className?: string }) {
  useLocale();
  const attention = state === "failed" || state === "attention" || state === "conflict";
  return (
    <span
      role="status"
      data-note-save-state={state}
      className={`note-save-status text-ui-caption ${
        attention ? "text-(--ui-tone-danger-fg)" : "text-(--ui-text-secondary)"
      } ${className ?? ""}`}
    >
      {t(LABELS[state])}
    </span>
  );
}
