import { useLayoutEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";

/** A transferred workspace stays inert until its native ownership acknowledgement succeeds. */
export function BootGate({
  children,
  transferred,
  onMounted,
}: {
  children: ReactNode | ((ready: boolean) => ReactNode);
  transferred: boolean;
  onMounted: () => void;
}) {
  const [transferReady, setTransferReady] = useState(false);
  useLayoutEffect(() => {
    onMounted();
    if (!transferred) return;
    let disposed = false;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        void invoke("window_transfer_ready")
          .then(() => {
            if (!disposed) setTransferReady(true);
          })
          .catch(console.error);
      });
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [transferred, onMounted]);
  return typeof children === "function" ? children(!transferred || transferReady) : children;
}
