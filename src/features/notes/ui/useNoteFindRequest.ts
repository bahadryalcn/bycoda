import { useEffect, useEffectEvent, type RefObject } from "react";
import { openSearchPanel, SearchQuery, setSearchQuery } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";

export type NoteFindRequest = { noteId: string; query: string; token: number } | null;

/**
 * Applies a library find request to this note's source editor: shows Source,
 * selects the first match and opens the search panel, then reports the token
 * as handled. It re-runs when the visible layout changes so the frame reads the
 * source editor that the mode switch mounted.
 */
export function useNoteFindRequest({
  findRequest,
  noteId,
  narrow,
  mode,
  showSource,
  editorViewRef,
  onFindHandled,
}: {
  findRequest: NoteFindRequest | undefined;
  noteId: string;
  narrow: boolean;
  mode: string;
  showSource: () => void;
  editorViewRef: RefObject<EditorView | null>;
  onFindHandled?: (token: number) => void;
}) {
  const reveal = useEffectEvent(() => showSource());
  const handled = useEffectEvent((token: number) => onFindHandled?.(token));
  useEffect(() => {
    if (!findRequest || findRequest.noteId !== noteId) return;
    reveal();
    const frame = requestAnimationFrame(() => {
      const view = editorViewRef.current;
      if (!view) return;
      const search = new SearchQuery({ search: findRequest.query, caseSensitive: false });
      view.dispatch({ effects: setSearchQuery.of(search) });
      const cursor = search.getCursor(view.state.doc);
      const match = cursor.next();
      if (!match.done)
        view.dispatch({
          selection: { anchor: match.value.from, head: match.value.to },
          scrollIntoView: true,
        });
      openSearchPanel(view);
      handled(findRequest.token);
    });
    return () => cancelAnimationFrame(frame);
  }, [findRequest, noteId, narrow, mode, editorViewRef]);
}
