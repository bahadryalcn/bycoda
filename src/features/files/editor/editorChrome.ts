import { syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { cspStyleNonce } from "../../../shared/lib/csp";
import type { ColorScheme } from "../../settings/model/appearance";
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
      // Native range, painted with the shared selection pair: the opaque fill and its ink are
      // derived together (accentContrast.ts), so syntax colours yield to the guaranteed
      // contrast instead of sitting on a tint that no pair can vouch for.
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
        backgroundColor: "var(--ui-text-selection-background) !important",
      },
      "::selection": {
        color: "var(--ui-text-selection-foreground)",
        WebkitTextFillColor: "var(--ui-text-selection-foreground)",
        textDecorationColor: "var(--ui-text-selection-foreground)",
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
