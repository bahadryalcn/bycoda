import { markdownLanguage } from "@codemirror/lang-markdown";
import type { SyntaxNode } from "@lezer/common";
import { Fragment, useEffect, useState, type ReactNode, type RefObject } from "react";
import styles from "./ComposerHighlight.module.css";

export function mayHaveComposerMarkdown(text: string): boolean {
  return /[*_`~<>[]|^ {0,3}(?:#{1,6}\s|[-+=](?:\s|[-+=])|\d+[.)]\s)/m.test(text);
}

const formats: Readonly<Record<string, string>> = {
  StrongEmphasis: "strong",
  Emphasis: "emphasis",
  Strikethrough: "strike",
  InlineCode: "code",
  FencedCode: "fence",
  CodeBlock: "fence",
  Blockquote: "quote",
  Link: "link",
};
const marks = new Set([
  "HeaderMark",
  "EmphasisMark",
  "StrikethroughMark",
  "CodeMark",
  "QuoteMark",
  "ListMark",
  "LinkMark",
  "TaskMarker",
]);

/** Format the existing text overlay, keeping source offsets in the native input. */
export function ComposerMarkdown({
  text,
  offset,
  field,
  renderText,
}: {
  text: string;
  offset: number;
  field?: RefObject<HTMLTextAreaElement | null>;
  renderText: (text: string) => ReactNode;
}) {
  const [editedMark, setEditedMark] = useState<number | null>(null);
  const tree = markdownLanguage.parser.parse(text);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Reveal just the syntax marker being edited as the native caret moves.
  useEffect(() => {
    const textarea = field?.current;
    if (!textarea) return;
    const sync = () => {
      const position = textarea.selectionStart - offset;
      if (
        textarea !== document.activeElement ||
        position < 0 ||
        textarea.selectionStart !== textarea.selectionEnd ||
        textarea.value.slice(offset) !== text
      ) {
        setEditedMark(null);
        return;
      }
      const node = tree.resolveInner(position, 1);
      setEditedMark(marks.has(node.name) ? node.from : null);
    };
    sync();
    document.addEventListener("selectionchange", sync);
    textarea.addEventListener("focus", sync);
    textarea.addEventListener("blur", sync);
    return () => {
      document.removeEventListener("selectionchange", sync);
      textarea.removeEventListener("focus", sync);
      textarea.removeEventListener("blur", sync);
    };
  }, [field, offset, text, tree]);

  function paint(node: SyntaxNode, literal = false): ReactNode | undefined {
    // Lezer recognizes shortcut references without a definition. Leave bracketed
    // app tokens intact so the composer can still paint attachments and citations.
    if (
      node.name === "Link" &&
      node.getChildren("LinkMark").length === 2 &&
      !node.getChild("LinkLabel")
    ) {
      return undefined;
    }
    if (marks.has(node.name)) {
      const raw = text.slice(node.from, node.to);
      const bullet = node.name === "ListMark" && /^[*+-]$/.test(raw);
      if (node.name === "ListMark" && !bullet) return undefined;
      const kind =
        node.name === "TaskMarker"
          ? raw === "[ ]"
            ? "task-open"
            : "task-done"
          : bullet && node.nextSibling?.name !== "Task"
            ? "bullet"
            : node.name === "QuoteMark"
              ? "quote-mark"
              : "mark";
      return (
        <span
          className={styles.markdownMarker}
          data-draft-markdown={kind}
          data-editing-mark={editedMark === node.from ? "" : undefined}
        >
          {raw}
        </span>
      );
    }
    const heading = /^(?:ATX|Setext)Heading[1-6]$/.test(node.name);
    const format = heading ? "heading" : formats[node.name];
    const insideCode = literal || format === "code" || format === "fence";
    const plain = insideCode ? (value: string) => value : renderText;
    const children: ReactNode[] = [];
    let from = node.from;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      const painted = paint(child, insideCode);
      if (painted === undefined) continue;
      if (from < child.from)
        children.push(<Fragment key={from}>{plain(text.slice(from, child.from))}</Fragment>);
      children.push(<Fragment key={child.from}>{painted}</Fragment>);
      from = child.to;
    }
    if (!format && !children.length) return undefined;
    if (from < node.to)
      children.push(<Fragment key={from}>{plain(text.slice(from, node.to))}</Fragment>);
    return format ? (
      <span className={styles.markdownText} data-draft-markdown={format}>
        {children}
      </span>
    ) : (
      children
    );
  }

  return paint(tree.topNode) ?? renderText(text);
}
