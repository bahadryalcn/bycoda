import {
  ConfirmMorph as ArcConfirmMorph,
  type ConfirmMorphProps,
} from "./arc/confirm-morph/confirm-morph";
import { useT } from "../i18n";

/**
 * In-place destructive action: the button morphs into Confirm/Cancel, then pending, done, error with Retry, and optional Undo. Modes `press`, `hold` (press held for `holdDuration`) and `countdown` (Cancel or Escape stops it). Default labels are delete wording; override them for other actions.
 * Undo must actually restore. It does not replace owner approval or exact-text confirmation.
 * Hand-written inline two-step delete and remove controls.
 * @group actions
 * @use In-place confirmation of a single row or item removal, preserving surrounding work and offering Cancel before confirm.
 * @avoid Blocking consequence review, typed confirmation or acknowledgement: ConfirmDialog. Non-destructive action: Button.
 * @arc confirm-morph
 */
export function ConfirmMorph(props: ConfirmMorphProps) {
  const t = useT();
  return (
    <ArcConfirmMorph
      confirmLabel={t("Confirm delete")}
      cancelLabel={t("Cancel")}
      pendingLabel={t("Deleting…")}
      doneLabel={t("Deleted")}
      errorLabel={t("Delete failed")}
      retryLabel={t("Retry")}
      undoLabel={t("Undo")}
      undoingLabel={t("Restoring…")}
      {...props}
      className={["bycoda-arc bycoda-arc-confirm", props.className].filter(Boolean).join(" ")}
    />
  );
}
