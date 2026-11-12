import { Text } from "../../../../../shared/ui/Text";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { t } from "../../../../../shared/i18n";
import { useStableCallback } from "../../../../../shared/hooks/useStableCallback";
import { Button } from "../../../../../shared/ui/Button";
import { ImagePlus } from "../../../../../shared/ui/icons";
import { dragPointToClient } from "../../../../../shared/lib/dragPoint";
import styles from "./BackgroundImage.module.css";

function pointInside(element: HTMLElement | null, x: number, y: number): boolean {
  if (!element) return false;
  const point = dragPointToClient(x, y);
  const rect = element.getBoundingClientRect();
  return (
    point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
  );
}

/** Tracks an OS file drag over `ref`; `onDrop` receives the first dropped path inside it. */
function useImageFileDrop(ref: RefObject<HTMLElement | null>, onDrop: (path: string) => void) {
  const [over, setOver] = useState(false);
  const dropLatest = useStableCallback(onDrop);
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    try {
      void getCurrentWebview()
        .onDragDropEvent(({ payload }) => {
          if (payload.type === "leave") {
            setOver(false);
            return;
          }
          const inside = pointInside(ref.current, payload.position.x, payload.position.y);
          if (payload.type !== "drop") {
            setOver(inside);
            return;
          }
          setOver(false);
          const path = payload.paths[0];
          if (inside && path) dropLatest(path);
        })
        .then((stop) => {
          if (cancelled) stop();
          else unlisten = stop;
        })
        .catch(() => undefined);
    } catch {
      // Outside the desktop shell there is no native drag source; clicking still works.
    }
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [ref, dropLatest]);
  return over;
}

/** Click, Enter or Space chooses an image; an image dropped from the OS is saved the same way. */
export function ImageDropZone({
  hasImage,
  busy,
  onChoose,
  children,
}: {
  hasImage: boolean;
  busy: boolean;
  onChoose: (droppedPath?: string) => void;
  children?: ReactNode;
}) {
  const zone = useRef<HTMLDivElement>(null);
  const over = useImageFileDrop(zone, (path) => {
    if (!busy) onChoose(path);
  });
  return (
    <div ref={zone} className={styles.dropWrap} data-over={over || undefined}>
      <Button
        variant="item"
        motion="none"
        fullWidth
        className={styles.drop}
        data-has-image={hasImage || undefined}
        aria-label={hasImage ? t("Change image") : t("Choose an image")}
        disabled={busy}
        onClick={() => onChoose()}
      >
        {children ?? (
          <Text size="caption" tone="muted" leading="inherit" className={styles.dropEmpty}>
            <ImagePlus className="icon-md" aria-hidden />
            <span>{t("Drop an image here or click to choose")}</span>
          </Text>
        )}
      </Button>
    </div>
  );
}
