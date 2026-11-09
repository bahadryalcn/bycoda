import { useSyncExternalStore } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { TransientNotice } from "../../../shared/ui/TransientNotice";
import {
  dismissWindowTransferNotice,
  getWindowTransferNotice,
  subscribeWindowTransferNotice,
} from "../../model/windowTransferNotice";

/**
 * Pending, refused, cancelled and rolled-back cross-window transfers. Danger notices stay until
 * dismissed so a failure is never lost to a timer; informational ones expire.
 */
export function WindowTransferNotice() {
  useLocale();
  const notice = useSyncExternalStore(
    subscribeWindowTransferNotice,
    getWindowTransferNotice,
    getWindowTransferNotice,
  );
  if (!notice) return null;
  return (
    <TransientNotice
      // A new publication restarts the notice and its timer.
      key={notice.id}
      tone={notice.tone}
      aria-label={t("Window transfer notice")}
      message={notice.message}
      onDismiss={dismissWindowTransferNotice}
    />
  );
}
