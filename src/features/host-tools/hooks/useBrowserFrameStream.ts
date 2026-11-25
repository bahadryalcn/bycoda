import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { isTauri } from "@tauri-apps/api/core";
type Stream = {
  read(after: number): Promise<ArrayBuffer>;
  close(): Promise<void>;
};
type Identity = { documentId: string; navigationId: string; width: number; height: number };

const subscribeVisibility = (notify: () => void) => {
  document.addEventListener("visibilitychange", notify);
  return () => document.removeEventListener("visibilitychange", notify);
};
const visibleDocument = () => !document.hidden;

export function parseBrowserFrame(raw: ArrayBuffer) {
  const bytes = new Uint8Array(raw);
  if (bytes.length === 0) return;
  if (bytes.length < 10 || bytes.length > 2 * 1024 * 1024 + 4)
    throw new Error("Invalid browser frame packet");
  const wire = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sequence = wire.getUint32(0);
  const end = 6 + wire.getUint16(4);
  if (end > bytes.length - 3 || end > 2048 || bytes[end] !== 255 || bytes[end + 1] !== 216)
    throw new Error("Invalid browser frame packet");
  const identity = JSON.parse(new TextDecoder().decode(bytes.subarray(6, end))) as Identity;
  if (
    typeof identity?.documentId !== "string" ||
    typeof identity.navigationId !== "string" ||
    !Number.isInteger(identity.width) ||
    identity.width < 1 ||
    identity.width > 2560 ||
    !Number.isInteger(identity.height) ||
    identity.height < 1 ||
    identity.height > 2160
  )
    throw new Error("Invalid browser frame identity");
  return { sequence, identity, jpeg: new Blob([bytes.subarray(end)], { type: "image/jpeg" }) };
}

/** Reads the native newest frame after each decode. No network pull or React update per frame. */
export function useBrowserFrameStream({
  enabled,
  canvas,
  open,
  prepare,
  current,
  painted,
}: {
  enabled: boolean;
  canvas: RefObject<HTMLCanvasElement | null>;
  open: () => Promise<Stream>;
  prepare: (frame: Identity) => Promise<boolean>;
  current: (frame: Identity) => boolean;
  painted: (frame: Identity) => void;
}) {
  const latest = useRef({ open, prepare, current, painted });
  latest.current = { open, prepare, current, painted };
  const [active, setActive] = useState(false);
  const visible = useSyncExternalStore(subscribeVisibility, visibleDocument);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- owns the native viewer and canvas while this preview is visible
  useEffect(() => {
    // Reason: follow the selected Host until this panel closes, pauses, or changes scope.
    if (!enabled || !visible || !isTauri() || typeof createImageBitmap !== "function") return;
    let stopped = false;
    let stream: Stream | undefined;
    let firstPaint = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let hadStream = false;
    const clear = () => {
      const viewer = stream;
      stream = undefined;
      if (viewer) void viewer.close().catch(() => {});
    };
    const run = async () => {
      stream = await latest.current.open();
      if (stopped) {
        clear();
        return;
      }
      let after = 0;
      while (!stopped) {
        const result = parseBrowserFrame(await stream.read(after));
        if (stopped || !result) continue;
        after = result.sequence;
        if (!canvas.current || !(await latest.current.prepare(result.identity)) || stopped)
          continue;
        const bitmap = await createImageBitmap(result.jpeg);
        try {
          const node = canvas.current;
          if (stopped || !node || !latest.current.current(result.identity)) continue;
          if (node.width !== bitmap.width || node.height !== bitmap.height) {
            node.width = bitmap.width;
            node.height = bitmap.height;
          }
          const context = node.getContext("2d", { alpha: false });
          if (!context) throw new Error("Browser frame canvas unavailable");
          context.drawImage(bitmap, 0, 0);
          node.hidden = false;
          latest.current.painted(result.identity);
          if (firstPaint) {
            firstPaint = false;
            hadStream = true;
            setActive(true);
          }
        } finally {
          bitmap.close();
        }
      }
    };
    const start = () => {
      void run().catch(() => {
        clear();
        if (stopped) return;
        firstPaint = true;
        setActive(false);
        if (hadStream) retry = setTimeout(start, 3000);
      });
    };
    start();
    return () => {
      stopped = true;
      clearTimeout(retry);
      clear();
      setActive(false);
    };
  }, [enabled, canvas, visible]);
  return active;
}
