import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { t } from "../../../shared/i18n";
import {
  EXPLORER_FILE_POINTER_DRAG_EVENT,
  type ExplorerFilePointerDragDetail,
} from "../../../shared/lib/drag";
import {
  droppedFileCount,
  endExternalDrop,
  nativeDropPointer,
  pointerInside,
  showExternalDrop,
} from "../../../shared/lib/externalDrop";
import { dragPointToClient } from "../../../shared/lib/dragPoint";
import {
  attachmentsFromFiles,
  attachmentsFromPaths,
  filesFromClipboard,
} from "../model/attachments";
import { attachmentDropVerdict, type AttachmentDropBlock } from "../model/attachmentDrop";
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
  /** The draft's current attachments, so the badge can say how many will fit. */
  attachmentsRef?: RefObject<readonly unknown[]>;
  persistBlobs?: boolean;
  readDroppedAttachments: (read: () => Promise<Attachment[]>) => void;
  setPasteError: Dispatch<SetStateAction<string | null>>;
};

/**
 * Drag-and-drop of files onto the composer box: DOM drags, the explorer's
 * pointer drags and the native webview drop. While a droppable drag is over the
 * box the box carries the shared drop mark and the cursor badge says what
 * releasing does ("Attach 2 files") or why it cannot; both go away on leave,
 * drop, Escape, blur and unmount. The reads themselves belong to the Composer.
 */
export function useComposerFileDrop({
  enabled,
  disabled,
  attachmentsSupported,
  boxRef,
  sinkRef,
  attachmentsRef,
  persistBlobs,
  readDroppedAttachments,
  setPasteError,
}: Options): void {
  const hideRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // A disabled composer is not a drop target at all: no mark, no badge, no native listener.
    if (!enabled || disabled) return;
    const dropRoot = () => boxRef.current;
    let nativeDropAt = 0;
    let nativeCount = 0;
    let showing = false;

    const hide = () => {
      if (!showing) return;
      showing = false;
      endExternalDrop();
    };
    hideRef.current = hide;

    const blockedBy = (explorer: boolean): AttachmentDropBlock | null => {
      const sink = sinkRef.current;
      if (!sink.attachmentsSupported) return "unsupported";
      if (explorer && sink.remote) return "remote";
      return null;
    };
    const show = (
      count: number,
      explorer: boolean,
      pointer: { clientX: number; clientY: number },
    ) => {
      showing = true;
      showExternalDrop(
        dropRoot(),
        attachmentDropVerdict(count, attachmentsRef?.current.length ?? 0, blockedBy(explorer)),
        pointer,
      );
    };

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
      data.dropEffect = blockedBy(false) ? "none" : "copy";
      show(droppedFileCount(data), false, event);
    };
    const onDragLeave = (event: DragEvent) => {
      const root = dropRoot();
      if (!root) return;
      const next = event.relatedTarget as Node | null;
      if (next && root.contains(next)) return;
      hide();
    };
    const onDrop = (event: DragEvent) => {
      const data = event.dataTransfer;
      if (!hasFiles(data)) return;
      event.preventDefault();
      hide();
      if (blockedBy(false)) return;
      if (Date.now() - nativeDropAt < 250) return;
      const files = filesFromClipboard(data);
      if (files.length === 0) return;
      readDroppedAttachments(() =>
        persistBlobs === undefined
          ? attachmentsFromFiles(files)
          : attachmentsFromFiles(files, { persistBlobs }),
      );
    };

    const onExplorerFilePointerDrag = (event: Event) => {
      const detail = (event as CustomEvent<ExplorerFilePointerDragDetail>).detail;
      if (!detail || detail.type === "end") {
        hide();
        return;
      }
      const over = overTarget(detail.x, detail.y);
      if (detail.type === "move") {
        if (!over) hide();
        else
          show((detail.paths ?? [detail.path]).length, true, {
            clientX: detail.x,
            clientY: detail.y,
          });
        return;
      }
      hide();
      if (!over || blockedBy(true)) return;
      readDroppedAttachments(() => attachmentsFromPaths(detail.paths ?? [detail.path]));
    };

    // Escape and losing the window end the gesture without a drop or a leave.
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };

    const root = dropRoot();
    root?.addEventListener("dragover", onDragOver);
    root?.addEventListener("dragleave", onDragLeave);
    root?.addEventListener("drop", onDrop);
    window.addEventListener(EXPLORER_FILE_POINTER_DRAG_EVENT, onExplorerFilePointerDrag);
    window.addEventListener("keydown", onEscape);
    window.addEventListener("blur", hide);
    window.addEventListener("dragend", hide);

    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void Promise.resolve()
      .then(() =>
        getCurrentWebview().onDragDropEvent((event) => {
          if (cancelled) return;
          if (event.payload.type === "leave") {
            nativeCount = 0;
            hide();
            return;
          }
          const { x, y } = event.payload.position;
          const point = dragPointToClient(x, y);
          const over = overTarget(point.x, point.y);
          if (event.payload.type === "enter" || event.payload.type === "over") {
            if (event.payload.type === "enter") nativeCount = event.payload.paths.length;
            if (!over) hide();
            else show(nativeCount, false, nativeDropPointer({ x, y }, pointerInside(dropRoot())));
            return;
          }
          if (event.payload.type !== "drop") return;
          nativeCount = 0;
          hide();
          if (!over || blockedBy(false)) return;
          if (event.payload.paths.length === 0) {
            setPasteError(
              t("This drag did not provide a file. Save the image, then drag the saved file here."),
            );
            return;
          }
          nativeDropAt = Date.now();
          const paths = event.payload.paths;
          readDroppedAttachments(() => attachmentsFromPaths(paths));
        }),
      )
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((error) => {
        console.warn("Composer operation failed", error);
      });

    return () => {
      cancelled = true;
      hide();
      if (hideRef.current === hide) hideRef.current = null;
      root?.removeEventListener("dragover", onDragOver);
      root?.removeEventListener("dragleave", onDragLeave);
      root?.removeEventListener("drop", onDrop);
      window.removeEventListener(EXPLORER_FILE_POINTER_DRAG_EVENT, onExplorerFilePointerDrag);
      window.removeEventListener("keydown", onEscape);
      window.removeEventListener("blur", hide);
      window.removeEventListener("dragend", hide);
      unlisten?.();
    };
  }, [disabled, enabled, persistBlobs, readDroppedAttachments]);

  // The verdict changes with the provider; the next drag event draws the new one.
  useEffect(() => {
    hideRef.current?.();
  }, [attachmentsSupported]);
}
