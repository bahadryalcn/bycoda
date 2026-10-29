import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";

export type NoteViewMode = "preview" | "source" | "split";
type NotePane = "source" | "preview";

/**
 * View mode, narrow single-pane routing and toolbar target for one open note.
 * The desktop mode is retained per note; a narrow panel shows one pane of Split
 * without overwriting it. The refs give image insertion and native drops the
 * committed mode and target outside render.
 */
export function useNoteEditorMode(noteId: string, previewEditing: boolean) {
  const detailRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const [narrowPane, setNarrowPane] = useState<NotePane>("source");
  useEffect(() => {
    const node = detailRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setNarrow(entry.contentRect.width <= 780);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const [mode, setModeState] = useRetainedState<NoteViewMode>(
    `note-editor:${noteId}:mode`,
    "preview",
  );
  // Narrow panels show one pane without overwriting the retained desktop mode.
  const visibleMode = narrow && mode === "split" ? narrowPane : mode;
  const [toolbarTarget, setToolbarTarget] = useState<NotePane>("source");
  const modeRef = useRef(visibleMode);
  const toolbarTargetRef = useRef(toolbarTarget);
  useLayoutEffect(() => {
    modeRef.current = visibleMode;
    toolbarTargetRef.current = toolbarTarget;
  }, [visibleMode, toolbarTarget]);

  const setMode = (next: NoteViewMode) => {
    if (narrow && mode === "split" && next !== "split") setNarrowPane(next);
    else setModeState(next);
    if (next !== "split") setToolbarTarget(next);
    // Entering Split keeps the toolbar on the editor that is already active,
    // so Bold works without refocusing: an active Document block stays the
    // target, a Source selection stays on Source.
    else if (visibleMode === "preview" && previewEditing) setToolbarTarget("preview");
    else if (visibleMode === "source") setToolbarTarget("source");
  };
  /** Shows the source editor for find without discarding a retained Split. */
  const showSource = () => {
    if (narrow && mode === "split") setNarrowPane("source");
    else setModeState("source");
    setToolbarTarget("source");
  };

  return {
    detailRef,
    narrow,
    mode,
    visibleMode,
    modeRef,
    setMode,
    showSource,
    toolbarTarget,
    setToolbarTarget,
    toolbarTargetRef,
  };
}
