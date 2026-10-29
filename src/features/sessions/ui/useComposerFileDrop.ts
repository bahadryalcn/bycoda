import { useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  EXPLORER_FILE_POINTER_DRAG_EVENT,
  type ExplorerFilePointerDragDetail,
} from "../../../shared/lib/drag";
import { dragPointToClient } from "../../../shared/lib/dragPoint";
import {
  attachmentsFromFiles,
  attachmentsFromPaths,
  filesFromClipboard,
} from "../model/attachments";
import type { Attachment } from "../model/session";
import { hasFiles } from "./composerTextareaEdit";
import type { AttachmentSink } from "./useComposerAttachments";

type Options = {
  enabled: boolean;
  disabled: boolean;
  attachmentsSupported: boolean;
  /** The drop target: the composer box. */
  boxRef: RefObject<HTMLElement | null>;
  sinkRef: RefObject<AttachmentSink>;
  readDroppedAttachments: (read: () => Promise<Attachment[]>) => void;
  setPasteError: Dispatch<SetStateAction<string | null>>;
};

/**
 * Drag-and-drop of files onto the composer box: DOM drags, the explorer's
 * pointer drags and the native webview drop. Returns whether a droppable drag
 * is currently over the box. The reads themselves belong to the Composer.
 */
export function useComposerFileDrop({
  enabled,
  disabled,
  attachmentsSupported,
  boxRef,
  sinkRef,
  readDroppedAttachments,
  setPasteError,
}: Options): boolean {
  const [fileDrag, setFileDrag] = useState(false);

  useEffect(() => {
    if (!enabled || disabled) {
      setFileDrag(false);
      return;
    }
    const dropRoot = () => boxRef.current;
    let nativeDropAt = 0;

    const overTarget = (x: number, y: number) => {
      const root = dropRoot();
      if (!root) return false;
      const rect = root.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    };

    const onDragOver = (event: DragEvent) => {
      const data = event.dataTransfer;
      if (!hasFiles(data)) return;
      event.preventDefault();
      const supported = sinkRef.current.attachmentsSupported;
      data.dropEffect = supported ? "copy" : "none";
      setFileDrag(supported);
    };
    const onDragLeave = (event: DragEvent) => {
      const root = dropRoot();
      if (!root) return;
      const next = event.relatedTarget as Node | null;
      if (next && root.contains(next)) return;
      setFileDrag(false);
    };
    const onDrop = (event: DragEvent) => {
      const data = event.dataTransfer;
      if (!hasFiles(data)) return;
      event.preventDefault();
      setFileDrag(false);
      if (!sinkRef.current.attachmentsSupported) return;
      if (Date.now() - nativeDropAt < 250) return;
      const files = filesFromClipboard(data);
      if (files.length === 0) return;
      readDroppedAttachments(() => attachmentsFromFiles(files));
    };

    const onExplorerFilePointerDrag = (event: Event) => {
      if (sinkRef.current.remote) return;
      const detail = (event as CustomEvent<ExplorerFilePointerDragDetail>).detail;
      if (!detail || detail.type === "end") {
        setFileDrag(false);
        return;
      }
      const over = overTarget(detail.x, detail.y);
      const supported = sinkRef.current.attachmentsSupported;
      if (detail.type === "move") {
        setFileDrag(over && supported);
        return;
      }
      setFileDrag(false);
      if (!over || !supported) return;
      readDroppedAttachments(() => attachmentsFromPaths(detail.paths ?? [detail.path]));
    };

    const root = dropRoot();
    root?.addEventListener("dragover", onDragOver);
    root?.addEventListener("dragleave", onDragLeave);
    root?.addEventListener("drop", onDrop);
    window.addEventListener(EXPLORER_FILE_POINTER_DRAG_EVENT, onExplorerFilePointerDrag);

    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (cancelled) return;
        if (event.payload.type === "leave") {
          setFileDrag(false);
          return;
        }
        const { x, y } = event.payload.position;
        const point = dragPointToClient(x, y);
        const over = overTarget(point.x, point.y);
        const supported = sinkRef.current.attachmentsSupported;
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setFileDrag(over && supported);
          return;
        }
        if (event.payload.type !== "drop") return;
        setFileDrag(false);
        if (!over || !supported) return;
        if (event.payload.paths.length === 0) {
          setPasteError(
            "This drag did not provide a file. Save the image, then drag the saved file here.",
          );
          return;
        }
        nativeDropAt = Date.now();
        const paths = event.payload.paths;
        readDroppedAttachments(() => attachmentsFromPaths(paths));
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((error) => {
        console.warn("Composer operation failed", error);
      });

    return () => {
      cancelled = true;
      root?.removeEventListener("dragover", onDragOver);
      root?.removeEventListener("dragleave", onDragLeave);
      root?.removeEventListener("drop", onDrop);
      window.removeEventListener(EXPLORER_FILE_POINTER_DRAG_EVENT, onExplorerFilePointerDrag);
      unlisten?.();
    };
  }, [disabled, enabled, readDroppedAttachments]);

  // Files can no longer be dropped once the provider cannot take them.
  useEffect(() => {
    if (!attachmentsSupported) setFileDrag(false);
  }, [attachmentsSupported]);

  return fileDrag;
}
