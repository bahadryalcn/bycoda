import type { Extension } from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
} from "@codemirror/view";
import { editorScrollbar } from "./editorScrollbar";
import { editorWrappedIndent } from "./editorWrappedIndent";

/**
 * The reading surface of the file editor, for code views that sit beside it (the merge
 * panes): numbered gutter, active line, wrapped lines hanging under their indent and the
 * editor's own scrollbar rail. Combine it with `schemeExtensions` for the shared theme.
 * No folding, so panes that scroll in step keep their lines aligned.
 */
export const editorSurface: Extension = [
  lineNumbers(),
  highlightActiveLine(),
  highlightActiveLineGutter(),
  EditorView.lineWrapping,
  editorWrappedIndent,
  editorScrollbar,
];
