import { Text } from "../../../shared/ui/Text";
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

/** Notes save automatically, so routine save progress stays silent. */
const QUIET: ReadonlySet<NoteSaveState> = new Set(["saved", "unsaved", "saving"]);

/** Recovery and errors take precedence over a pending or clean draft. */
export function noteSaveState(state: {
  deleting: boolean;
  saveError: string | null;
  titleError: string | undefined;
  recovering: boolean;
  saving: boolean;
  dirty: boolean;
}): NoteSaveState {
  if (state.deleting) return "deleting";
  if (state.saveError) return "failed";
  if (state.titleError) return "attention";
  if (state.recovering) return "recovering";
  if (state.saving) return "saving";
  return state.dirty ? "unsaved" : "saved";
}

/** Shows only states that need the user's attention; autosave progress renders nothing. */
export function NoteSaveStatus({ state, className }: { state: NoteSaveState; className?: string }) {
  useLocale();
  if (QUIET.has(state)) return null;
  const attention = state === "failed" || state === "attention" || state === "conflict";
  return (
    <Text
      size="caption"
      tone={attention ? "danger" : "secondary"}
      role="status"
      data-note-save-state={state}
      className={`note-save-status ${className ?? ""}`}
    >
      {t(LABELS[state])}
    </Text>
  );
}
