import { Text } from "../../../shared/ui/Text";
import { t, useLocale } from "../../../shared/i18n";
import { Check } from "../../../shared/ui/icons";
import { Tooltip } from "../../../shared/ui/Tooltip";

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

export function NoteSaveStatus({
  state,
  className,
  compact = false,
}: {
  state: NoteSaveState;
  className?: string;
  compact?: boolean;
}) {
  useLocale();
  const attention = state === "failed" || state === "attention" || state === "conflict";
  return (
    <Text
      size="caption"
      tone={attention ? "danger" : "secondary"}
      role="status"
      data-note-save-state={state}
      className={`note-save-status ${className ?? ""}`}
    >
      {compact && state === "saved" ? (
        <Tooltip label={t("Saved")}>
          <span>
            <Check className="icon-sm" />
            <span className="sr-only">{t("Saved")}</span>
          </span>
        </Tooltip>
      ) : (
        t(LABELS[state])
      )}
    </Text>
  );
}
