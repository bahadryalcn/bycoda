import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { dragPointToClient } from "../../../shared/lib/dragPoint";
import { createParentOf } from "../model/fileTree";

type FileTreeExternalDropOptions = {
  cwd: string;
  rootRef: RefObject<HTMLDivElement | null>;
  dropFilesRef: RefObject<(paths: string[], targetPath: string) => Promise<void>>;
  setDragOverPath: Dispatch<SetStateAction<string | null>>;
};

/** Routes operating-system file drops over the tree into the latest drop handler. */
export function useFileTreeExternalDrop({
  cwd,
  rootRef,
  dropFilesRef,
  setDragOverPath,
}: FileTreeExternalDropOptions) {
  useEffect(() => {
    const treePathAt = (x: number, y: number): string | null => {
      const root = rootRef.current;
      if (!root) return null;
      const point = dragPointToClient(x, y);
      const el = document.elementFromPoint(point.x, point.y);
      if (!el || !root.contains(el)) return null;
      return el.closest<HTMLElement>("[role='treeitem']")?.title ?? cwd;
    };

    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "leave") {
          setDragOverPath(null);
          return;
        }
        const { x, y } = event.payload.position;
        const target = treePathAt(x, y);
        if (event.payload.type !== "drop") {
          setDragOverPath(target ? createParentOf(cwd, target) : null);
          return;
        }
        setDragOverPath(null);
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
  }, [cwd]);
}
