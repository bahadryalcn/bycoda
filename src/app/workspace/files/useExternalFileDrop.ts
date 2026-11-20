import { useEffect, useRef } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { dragPointToClient } from "../../../shared/lib/dragPoint";
import { parentPath, pathKey } from "../../../shared/lib/paths";
import { isLocalDirectory } from "../../../platform/tauri/fs";
import { t } from "../../../shared/i18n";
import { toast } from "../../../shared/ui/ToastRegion";
import type { EditorFileOpen } from "./useEditorFileOpen";

/** Why a dropped path was not opened; each one gets its own localized sentence. */
type IgnoredDrop = "folder" | "invalid" | "failed";

/** One toast id, so repeated rejected drops replace each other instead of stacking. */
const IGNORED_DROP_TOAST = "external-file-drop-ignored";

function ignoredDropMessage(reason: IgnoredDrop): string {
  switch (reason) {
    case "folder":
      return t("Folders can't be opened as files.");
    case "invalid":
      return t("Only local files can be opened by dropping them here.");
    case "failed":
      return t("Couldn't open a dropped file.");
  }
}

/** Tells the user why a drop opened nothing, while successfully opened siblings stay open. */
function reportIgnoredDrops(reasons: ReadonlySet<IgnoredDrop>): void {
  if (reasons.size === 0) return;
  toast.show({
    id: IGNORED_DROP_TOAST,
    tone: "warning",
    message: [...reasons].map(ignoredDropMessage).join(" "),
  });
}

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
        // Each path settles on its own: a rejected sibling never blocks or cancels the others.
        void Promise.all(
          paths.map(async (path): Promise<IgnoredDrop | null> => {
            // Native drops contain local absolute paths. Never reinterpret them as remote files.
            if (!/^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(path)) return "invalid";
            let directory: boolean;
            try {
              directory = await isLocalDirectory(path);
            } catch (error: unknown) {
              console.error("Failed to open dropped files:", error);
              return "failed";
            }
            if (cancelled) return null;
            if (directory) return "folder";
            const cwd = parentPath(path);
            openRef.current(
              path,
              undefined,
              { exact: true, pin: true },
              { cwd, projectCwd: "", external: true },
            );
            return null;
          }),
        )
          .then((results) => {
            if (!cancelled) {
              reportIgnoredDrops(new Set(results.filter((r): r is IgnoredDrop => r !== null)));
            }
          })
          .catch((error: unknown) => console.error("Failed to open dropped files:", error));
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
