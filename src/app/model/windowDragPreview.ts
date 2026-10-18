import { invoke } from "@tauri-apps/api/core";

let lastRevision = 0;
function revision() {
  lastRevision = Math.max(
    lastRevision + 1,
    Math.floor((performance.timeOrigin + performance.now()) * 1000),
  );
  return lastRevision;
}

/** Native routing reaches the other webview even while source pointer capture owns the gesture. */
export function beginWindowTabDrag(sourceId: string, sourceIds: string[] = [sourceId]) {
  const dragId = crypto.randomUUID();
  let point: { clientX: number; clientY: number; pixelRatio: number } | undefined;
  let ended = false;
  let pending = false;
  let dirty = false;
  let frame: number | undefined;
  const schedule = () => {
    if (ended || frame !== undefined) return;
    frame = window.requestAnimationFrame(() => {
      frame = undefined;
      publish();
    });
  };
  const publish = () => {
    if (ended || !point) return;
    if (pending) {
      dirty = true;
      return;
    }
    pending = true;
    dirty = false;
    void invoke("preview_window_tab_drag", {
      dragId,
      sourceId,
      sourceIds,
      ...point,
      revision: revision(),
    })
      .catch(() => {
        /* Browser previews have no native transport. */
      })
      .finally(() => {
        pending = false;
        if (dirty) schedule();
      });
  };
  const heartbeat = window.setInterval(publish, 350);
  return {
    move(next: { clientX: number; clientY: number }) {
      if (ended) return;
      point = { clientX: next.clientX, clientY: next.clientY, pixelRatio: window.devicePixelRatio };
      schedule();
    },
    finish() {
      if (ended) return;
      ended = true;
      window.clearInterval(heartbeat);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      // Native revision tombstones reject older in-flight hover commands.
      void invoke("clear_window_tab_drag", { dragId, revision: revision() }).catch(() => {});
    },
  };
}

export type WindowTabDragHover = {
  dragId: string;
  sourceWindowLabel: string;
  sourceId: string;
  sourceIds?: string[];
  revision: number;
  x?: number;
  y?: number;
  scaleFactor?: number;
  ended: boolean;
};
