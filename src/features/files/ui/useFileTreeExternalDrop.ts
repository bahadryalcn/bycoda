import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { t } from "../../../shared/i18n";
import { useExternalDropFeedback } from "../../../shared/hooks/useExternalDropFeedback";
import { nativeDropPointer, pointerInside } from "../../../shared/lib/externalDrop";
import { dragPointToClient } from "../../../shared/lib/dragPoint";
import { createParentOf } from "../model/fileTree";

type FileTreeExternalDropOptions = {
  cwd: string;
  rootRef: RefObject<HTMLDivElement | null>;
  dropFilesRef: RefObject<(paths: string[], targetPath: string) => Promise<void>>;
  setDragOverPath: Dispatch<SetStateAction<string | null>>;
  /** True while a file operation runs; the drop would be ignored, so the badge says so. */
  operationRunning?: RefObject<boolean>;
};

function folderName(path: string) {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1) || path;
}

/**
 * Routes operating-system file drops over the tree into the latest drop handler. The folder that
 * would receive the copy carries the shared drop mark (the tree root for the project folder) and
 * the cursor badge says what releasing does: "Copy 2 items into src". The mark and badge end on
 * leave, drop, Escape, blur and unmount.
 */
export function useFileTreeExternalDrop({
  cwd,
  rootRef,
  dropFilesRef,
  setDragOverPath,
  operationRunning,
}: FileTreeExternalDropOptions) {
  const { show, hide } = useExternalDropFeedback();
  useEffect(() => {
    const treePathAt = (x: number, y: number): string | null => {
      const root = rootRef.current;
      if (!root) return null;
      const point = dragPointToClient(x, y);
      const el = document.elementFromPoint(point.x, point.y);
      if (!el || !root.contains(el)) return null;
      return el.closest<HTMLElement>("[role='treeitem']")?.title ?? cwd;
    };
    const folderElement = (folder: string): HTMLElement | null => {
      const root = rootRef.current;
      if (!root || folder === cwd) return root;
      return (
        Array.from(root.querySelectorAll<HTMLElement>("[role='treeitem']")).find(
          (item) => item.title === folder,
        ) ?? root
      );
    };

    let cancelled = false;
    let unlisten: (() => void) | undefined;
    let count = 0;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        // The shared mark replaces the row's own drop highlight.
        setDragOverPath(null);
        if (event.payload.type === "leave") {
          count = 0;
          hide();
          return;
        }
        const { x, y } = event.payload.position;
        const target = treePathAt(x, y);
        if (event.payload.type !== "drop") {
          if (event.payload.type === "enter") count = event.payload.paths?.length ?? 0;
          if (!target) {
            hide();
            return;
          }
          const folder = createParentOf(cwd, target);
          const name = folderName(folder);
          show(
            folderElement(folder),
            operationRunning?.current
              ? { kind: "blocked", reason: t("Wait for the current file operation to finish") }
              : {
                  kind: "accept",
                  label:
                    count === 0
                      ? t("Copy files into {p0}", { p0: name })
                      : count === 1
                        ? t("Copy 1 item into {p0}", { p0: name })
                        : t("Copy {p0} items into {p1}", { p0: count, p1: name }),
                },
            nativeDropPointer({ x, y }, pointerInside(rootRef.current)),
          );
          return;
        }
        count = 0;
        hide();
        if (target) void dropFilesRef.current(event.payload.paths, target);
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [cwd, show, hide]);
}
