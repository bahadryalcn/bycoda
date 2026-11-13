import { t } from "../../../shared/i18n";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";

/** Keeps unsaved source settings visible until the owner explicitly discards them. */
export function useDecisionDialogClose(dirty: boolean, pending: boolean, onClose: () => void) {
  const { confirm, dialog } = useConfirm();
  const requestClose = () => {
    if (pending) return;
    if (!dirty) return onClose();
    void confirm({
      title: t("Discard changes?"),
      message: t("Your source settings have not been saved."),
      confirmLabel: t("Discard changes"),
    }).then((discard) => {
      if (discard) onClose();
    });
  };
  return { requestClose, dialog };
}
