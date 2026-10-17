import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LAYER } from "../../../shared/lib/layers";
import { SYNC_MERGED_MESSAGE, subscribeSyncMerged } from "../model/syncClient";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";

const VISIBLE_MS = 5000;
const FADE_MS = 300;

export function SyncMergedNotice() {
  useLocale();
  const [visible, setVisible] = useState(false);
  const [fading, setFading] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const clear = () => {
      timers.current.forEach((id) => window.clearTimeout(id));
      timers.current = [];
    };
    const unsubscribe = subscribeSyncMerged(() => {
      clear();
      setVisible(true);
      setFading(false);
      timers.current = [
        window.setTimeout(() => setFading(true), VISIBLE_MS - FADE_MS),
        window.setTimeout(() => setVisible(false), VISIBLE_MS),
      ];
    });
    return () => {
      unsubscribe();
      clear();
    };
  }, []);

  if (!visible) return null;
  return createPortal(
    <Button
      type="button"
      role="status"
      aria-label={t("Dismiss sync notice")}
      style={{ zIndex: LAYER.toast }}
      variant="item"
      motion="none"
      layout="stacked"
      className={`fixed right-3 bottom-3 w-[min(340px,calc(100vw-24px))] text-left transition-opacity duration-300 motion-reduce:transition-none ${fading ? "opacity-0" : "opacity-100"}`}
      onClick={() => setVisible(false)}
    >
      <Alert tone="info" role="presentation">
        {SYNC_MERGED_MESSAGE}
      </Alert>
    </Button>,
    document.body,
  );
}
