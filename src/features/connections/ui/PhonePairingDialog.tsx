import { t, useLocale } from "../../../shared/i18n";
import { Modal } from "../../../shared/ui/Modal";
import type { PhonePairingDialogProps } from "../model/phonePairingTypes";
import { PhonePairingFlow } from "./PhonePairingFlow";

/** The pairing flow in a modal, for callers that supply their own endpoint (external tunnels). */
export function PhonePairingDialog(props: PhonePairingDialogProps) {
  useLocale();
  return (
    <Modal
      title={t("Connect your phone")}
      description={t("Manage this computer from bycoda on your phone.")}
      onClose={props.onClose}
      size="md"
    >
      <PhonePairingFlow variant="dialog" {...props} />
    </Modal>
  );
}
