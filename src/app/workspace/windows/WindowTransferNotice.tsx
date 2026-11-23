import { useEffect } from "react";
import { toast } from "../../../shared/ui/ToastRegion";
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
  // Bridge the transfer store into the workbench's shared toast region.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- mirrors window-transfer store notices into the toast region
  useEffect(() => {
    let activeId: string | undefined;
    const sync = () => {
      const notice = getWindowTransferNotice();
      if (activeId) {
        const previous = activeId;
        activeId = undefined;
        toast.dismiss(previous);
      }
      if (!notice) return;
      const id = `window-transfer-${notice.id}`;
      activeId = id;
      toast.show({
        id,
        tone: notice.tone,
        message: notice.message,
        durationMs: notice.tone === "danger" ? null : undefined,
        onDismiss: () => {
          if (activeId !== id) return;
          activeId = undefined;
          dismissWindowTransferNotice();
        },
      });
    };
    const unsubscribe = subscribeWindowTransferNotice(sync);
    sync();
    return () => {
      unsubscribe();
      const previous = activeId;
      activeId = undefined;
      if (previous) toast.dismiss(previous);
    };
  }, []);
  return null;
}
