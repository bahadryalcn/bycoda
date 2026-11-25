import { LiveText } from "../../../shared/ui/LiveText";
import { t, useLocale } from "../../../shared/i18n";

/** One save/recovery vocabulary for the library editor and the session note panel. */
export type NoteSaveState =
  | "deleting"
  | "failed"
  | "conflict"
  | "recovering"
  | "saving"
  | "unsaved"
  | "saved";

function noteSaveLabel(state: NoteSaveState): string {
  switch (state) {
    case "deleting":
      return t("Deleting…");
    case "failed":
      return t("Save failed");
    case "conflict":
      return t("Changed elsewhere");
    case "recovering":
      return t("Saving recovery copy…");
    case "saving":
      return t("Saving…");
    case "unsaved":
      return t("Unsaved changes");
    case "saved":
      return t("Saved");
  }
}

/** Notes save automatically, so routine save progress stays silent. */
const QUIET: ReadonlySet<NoteSaveState> = new Set(["saved", "unsaved", "saving"]);

/** Recovery and errors take precedence over a pending or clean draft; title errors show on the title field only. */
export function noteSaveState(state: {
  deleting: boolean;
  saveError: string | null;
  recovering: boolean;
  saving: boolean;
  dirty: boolean;
}): NoteSaveState {
  if (state.deleting) return "deleting";
  if (state.saveError) return "failed";
  if (state.recovering) return "recovering";
  if (state.saving) return "saving";
  return state.dirty ? "unsaved" : "saved";
}

/** Background saves stay quiet; recovery and errors remain visible. */
export function NoteSaveStatus({ state, className }: { state: NoteSaveState; className?: string }) {
  useLocale();
  if (QUIET.has(state)) return null;
  const attention = state === "failed" || state === "conflict";
  return (
    <LiveText
      text={noteSaveLabel(state)}
      size="caption"
      tone={attention ? "danger" : "secondary"}
      className={`note-save-status ${className ?? ""}`}
    />
  );
}
