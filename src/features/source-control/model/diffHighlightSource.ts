import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { highlightCode } from "@lezer/highlight";
import type { ColorScheme } from "../../settings/model/appearance";
import type { SyntaxToken } from "../../files/editor/syntaxTokens";
import { syntaxTagHighlighter } from "../../files/editor/editorLanguage";
const SYNTAX_TREE_BUDGET_MS = 100;

export function highlightSource(
  text: string,
  language: Extension | null,
  scheme: ColorScheme,
): SyntaxToken[][] {
  if (!text) return [[]];
  if (!language) return unstyledLines(text);

  const state = EditorState.create({
    doc: text,
    extensions: [language],
  });
  const code = state.doc.toString();
  const tree =
    ensureSyntaxTree(state, state.doc.length, SYNTAX_TREE_BUDGET_MS) ?? syntaxTree(state);
  const highlighter = syntaxTagHighlighter(scheme);
  const lines: SyntaxToken[][] = [[]];
  highlightCode(
    code,
    tree,
    highlighter,
    (piece, color) => {
      if (!piece) return;
      lines[lines.length - 1]?.push({
        text: piece,
        ...(color ? { color } : {}),
      });
    },
    () => {
      lines.push([]);
    },
  );
  return lines;
}

function unstyledLines(text: string): SyntaxToken[][] {
  return text.split("\n").map((line) => (line ? [{ text: line }] : []));
}
