import { syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { cspStyleNonce } from "../../../shared/lib/csp";
import type { ColorScheme } from "../../settings";
import { editorHighlightStyleFor } from "./editorLanguage";

export { editorHighlightStyleFor, languageForPath } from "./editorLanguage";

function editorThemeStyles(dark: boolean) {
  return EditorView.theme(
    {
      "&": {
        height: "100%",
        backgroundColor: "transparent",
        color: "var(--color-content)",
        fontSize: "var(--appearance-code-size, 13px)",
        userSelect: "text",
      },
      "&.cm-focused": {
        outline: "none",
      },
      ".cm-scroller": {
        overflow: "auto",
        overscrollBehavior: "none",
        fontFamily: "var(--font-mono)",
        lineHeight: "1.6",
      },
      ".cm-content": {
        minHeight: "100%",
        // Longhands, not the `padding` shorthand: the scrollbar reserves the
        // right-hand strip with `padding-right`, and a shorthand here would
        // reset it to 0 depending on which style module mounts last.
        paddingTop: "8px",
        paddingBottom: "32px",
        caretColor: "var(--color-content)",
      },
      ".cm-line": {
        padding: "0 12px 0 6px",
      },
      ".cm-gutters": {
        backgroundColor: "transparent",
        color: "var(--ui-editor-gutter-text)",
        borderRight: "1px solid var(--color-stroke)",
        paddingLeft: "4px",
      },
      ".cm-lineNumbers .cm-gutterElement": {
        minWidth: "36px",
        padding: "0 8px 0 4px",
      },
      ".cm-foldGutter": {
        width: "12px",
      },
      ".cm-foldGutter .cm-gutterElement": {
        padding: "0 2px",
        cursor: "pointer",
        color: "var(--ui-editor-gutter-text)",
      },
      ".cm-foldPlaceholder": {
        color: "var(--ui-text-muted)",
      },
      ".cm-activeLine": {
        backgroundColor: "var(--ui-editor-active-line)",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "var(--ui-editor-active-line)",
        color: "var(--ui-editor-gutter-active-text)",
      },
      // Code keeps its syntax colours under a selection, so the range is the shared overlay
      // tint (as in other code editors), not the opaque prose fill whose paired ink CodeMirror's
      // drawn selection layer cannot apply. Unfocused editors keep a quieter neutral range.
      ".cm-selectionBackground, ::selection": {
        backgroundColor: "var(--ui-selection-inactive) !important",
      },
      "&.cm-focused .cm-selectionBackground, &.cm-focused ::selection": {
        backgroundColor: "var(--ui-overlay-selection-background) !important",
      },
      // The global prose rule recolours selected glyphs with the opaque fill's ink; code keeps
      // each token's own colour under the tint.
      ".cm-content ::selection, .cm-content::selection": {
        color: "currentcolor",
        WebkitTextFillColor: "currentcolor",
        textDecorationColor: "currentcolor",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--color-content)",
      },
      ".cm-matchingBracket": {
        backgroundColor: "var(--ui-surface-hover)",
        outline: "1px solid var(--ui-pane-border)",
      },
      ".cm-nonmatchingBracket": {
        backgroundColor: "var(--ui-selection-inactive)",
        outline: "1px solid var(--color-danger)",
      },
      ".cm-panels": {
        backgroundColor: "var(--color-background-base)",
        color: "var(--color-content)",
        borderColor: "var(--color-stroke)",
      },
      ".cm-tooltip": {
        backgroundColor: "var(--ui-surface-floating)",
        color: "var(--color-content)",
        border: "1px solid var(--ui-pane-border)",
        borderRadius: "6px",
        overflow: "hidden",
      },
      ".cm-tooltip.cm-tooltip-autocomplete": {
        backgroundColor: "var(--ui-surface-floating)",
      },
      ".cm-tooltip-autocomplete > ul": {
        fontFamily: "var(--font-mono)",
        fontSize: "12px",
        maxHeight: "240px",
      },
      ".cm-tooltip-autocomplete > ul > li": {
        padding: "2px 8px",
      },
      ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
        backgroundColor: "var(--ui-surface-selected)",
        color: "var(--color-content)",
      },
      ".cm-completionDetail": {
        color: "var(--ui-text-secondary)",
        fontStyle: "normal",
        marginLeft: "8px",
      },
      "@media (forced-colors: active)": {
        ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
          backgroundColor: "Highlight !important",
          forcedColorAdjust: "auto",
        },
        "::selection": { backgroundColor: "Highlight !important", color: "HighlightText" },
      },
    },
    { dark },
  );
}

/**
 * The theme, plus whatever CSP nonce its style sheet needs. CodeMirror mounts
 * every rule it owns — base theme included — through style-mod at runtime, so a
 * style-src that rejects inline sheets leaves the editor completely unstyled.
 * See `cspStyleNonce` for why this is currently a no-op.
 */
export function editorThemeFor(scheme: ColorScheme): Extension {
  return [editorThemeStyles(scheme === "dark"), EditorView.cspNonce.of(cspStyleNonce())];
}

export function schemeExtensions(scheme: ColorScheme): Extension[] {
  return [editorThemeFor(scheme), syntaxHighlighting(editorHighlightStyleFor(scheme))];
}
