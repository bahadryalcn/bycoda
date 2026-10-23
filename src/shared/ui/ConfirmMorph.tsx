import {
  ConfirmMorph as ArcConfirmMorph,
  type ConfirmMorphProps,
} from "./arc/confirm-morph/confirm-morph";
import { useT } from "../i18n";

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
