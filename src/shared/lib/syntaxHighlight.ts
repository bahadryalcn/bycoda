import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { highlightCode, tagHighlighter, tags } from "@lezer/highlight";

export type SyntaxToken = {
  text: string;
  color?: string;
};

const SYNTAX_TREE_BUDGET_MS = 100;

const syntaxTags = {
  keyword: [
    tags.keyword,
    tags.controlKeyword,
    tags.definitionKeyword,
    tags.moduleKeyword,
    tags.operatorKeyword,
    tags.modifier,
    tags.self,
  ],
  callable: [
    tags.function(tags.variableName),
    tags.function(tags.propertyName),
    tags.labelName,
    tags.macroName,
  ],
  string: [
    tags.string,
    tags.docString,
    tags.character,
    tags.attributeValue,
    tags.special(tags.string),
    tags.regexp,
    tags.escape,
  ],
  type: [tags.typeName, tags.className, tags.namespace, tags.standard(tags.typeName)],
  number: [tags.number, tags.integer, tags.float, tags.bool, tags.null, tags.atom, tags.unit],
  comment: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
  property: [tags.propertyName, tags.attributeName],
  meta: [tags.meta, tags.processingInstruction, tags.annotation],
  heading: [
    tags.heading,
    tags.heading1,
    tags.heading2,
    tags.heading3,
    tags.heading4,
    tags.heading5,
    tags.heading6,
  ],
};

const syntaxColors = {
  keyword: "var(--syntax-keyword)",
  heading: "var(--color-markdown-heading)",
  callable: "var(--syntax-callable)",
  string: "var(--syntax-string)",
  type: "var(--syntax-type)",
  number: "var(--syntax-number)",
  comment: "var(--syntax-comment)",
  property: "var(--syntax-property)",
  meta: "var(--syntax-meta)",
  invalid: "var(--color-danger)",
};

const syntaxTagColors = [
  { tag: syntaxTags.keyword, class: syntaxColors.keyword },
  { tag: syntaxTags.heading, class: syntaxColors.heading },
  { tag: syntaxTags.callable, class: syntaxColors.callable },
  { tag: syntaxTags.string, class: syntaxColors.string },
  { tag: syntaxTags.type, class: syntaxColors.type },
  { tag: syntaxTags.number, class: syntaxColors.number },
  { tag: syntaxTags.comment, class: syntaxColors.comment },
  { tag: syntaxTags.property, class: syntaxColors.property },
  { tag: syntaxTags.meta, class: syntaxColors.meta },
  { tag: tags.tagName, class: "var(--syntax-tag)" },
  { tag: tags.invalid, class: syntaxColors.invalid },
];

/** Same tag map and theme tokens as the editor, for syntax outside CodeMirror. */
export function highlightSource(
  text: string,
  language: Extension | null,
  _scheme: "dark" | "light",
): SyntaxToken[][] {
  if (!text) return [[]];
  if (!language) return text.split("\n").map((line) => (line ? [{ text: line }] : []));

  const state = EditorState.create({ doc: text, extensions: [language] });
  const code = state.doc.toString();
  const tree =
    ensureSyntaxTree(state, state.doc.length, SYNTAX_TREE_BUDGET_MS) ?? syntaxTree(state);
  const highlighter = tagHighlighter(syntaxTagColors);
  const lines: SyntaxToken[][] = [[]];
  highlightCode(
    code,
    tree,
    highlighter,
    (piece, color) => {
      if (!piece) return;
      lines[lines.length - 1]?.push({ text: piece, ...(color ? { color } : {}) });
    },
    () => {
      lines.push([]);
    },
  );
  return lines;
}
