import { t, useLocale } from "../../../shared/i18n";
import { Modal } from "../../../shared/ui/Modal";
import type { PhonePairingDialogProps } from "../model/phonePairingTypes";
import { PhonePairingFlow } from "./PhonePairingFlow";

/** Phone pairing from Devices or from a fixed endpoint such as a shared Host link. */
export function PhonePairingDialog(props: PhonePairingDialogProps) {
  useLocale();
  return (
    <Modal
      title={t("Connect your phone")}
      onClose={props.onClose}
      size="md"
    >
      <PhonePairingFlow variant="dialog" {...props} />
    </Modal>
  );
}
