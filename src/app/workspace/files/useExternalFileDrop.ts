import { useEffect, useRef } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { dragPointToClient } from "../../../shared/lib/dragPoint";
import { parentPath, pathKey } from "../../../shared/lib/paths";
import { isLocalDirectory } from "../../../platform/tauri/fs";
import type { EditorFileOpen } from "./useEditorFileOpen";

/** Start the optional editor while the user is still dragging, without blocking the drop. */
function preloadDroppedEditor(paths: readonly string[]): void {
  if (paths.some((path) => /\.(md|mdx|markdown|html?|txt|json|csv|tsv)$/i.test(path))) {
    void import("../../../features/files/ui/FileEditor").catch(() => undefined);
  }
}

/** Dedicated attachment/copy targets keep ownership of their native drops. */
export function externalFileDropTarget(x: number, y: number): boolean {
  const target = document.elementFromPoint(x, y);
  return !!target && !target.closest("[data-composer-box], [data-external-drop-owner]");
}

/** Open original local files, even when the selected project belongs to a remote host. */
export function useExternalFileDrop(onOpenFile: EditorFileOpen["onOpenFile"]): void {
  const openRef = useRef(onOpenFile);
  openRef.current = onOpenFile;
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        if (cancelled) return;
        if (payload.type === "enter") {
          preloadDroppedEditor(payload.paths);
          return;
        }
        if (payload.type !== "drop") return;
        const point = dragPointToClient(payload.position.x, payload.position.y);
        if (!externalFileDropTarget(point.x, point.y)) return;
        const paths = [...new Map(payload.paths.map((path) => [pathKey(path), path])).values()];
        preloadDroppedEditor(paths);
        void Promise.all(
          paths.map(async (path) => {
            // Native drops contain local absolute paths. Never reinterpret them as remote files.
            if (!/^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(path)) return;
            const directory = await isLocalDirectory(path);
            if (cancelled) return;
            if (directory) return;
            const cwd = parentPath(path);
            openRef.current(
              path,
              undefined,
              { exact: true, pin: true },
              { cwd, projectCwd: "", external: true },
            );
          }),
        ).catch((error: unknown) => console.error("Failed to open dropped files:", error));
      })
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
