import { markdownLanguage } from "@codemirror/lang-markdown";
import type { Range } from "@codemirror/state";
import { Decoration, type DecorationSet } from "@codemirror/view";
import type { SyntaxNode, Tree } from "@lezer/common";
import { Fragment, useEffect, useState, type ReactNode, type RefObject } from "react";
import { cachedUserLinkRanges } from "../model/linkPreview";
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

function markdownFormat(node: SyntaxNode) {
  if (/^(?:ATX|Setext)Heading[1-6]$/.test(node.name)) return "heading";
  // Lezer also treats unresolved app references such as [file1] as shortcut links.
  if (
    node.name === "Link" &&
    node.getChildren("LinkMark").length === 2 &&
    !node.getChild("LinkLabel")
  )
    return undefined;
  return formats[node.name];
}

function markdownMarker(node: SyntaxNode, raw: string) {
  if (node.name === "TaskMarker") return raw === "[ ]" ? "task-open" : "task-done";
  if (node.name === "QuoteMark") return "quote-mark";
  if (node.name !== "ListMark") return "mark";
  if (!/^[*+-]$/.test(raw)) return undefined;
  return node.nextSibling?.name === "Task" ? "mark" : "bullet";
}

export function composerMarkdownMarkAt(tree: Tree, from: number, to: number): number | null {
  if (from !== to) return null;
  const node = tree.resolveInner(from, 1);
  return marks.has(node.name) ? node.from : null;
}

/** Paint the parsed draft in CodeMirror, preserving the source for editing and clipboard. */
export function composerMarkdownDecorations(
  tree: Tree,
  text: string,
  editedMark: number | null,
): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  tree.iterate({
    enter({ node, from, to }) {
      if (from === to) return;
      const marker = marks.has(node.name);
      const kind = marker ? markdownMarker(node, text.slice(from, to)) : markdownFormat(node);
      if (node.name === "Link" && !kind) return false;
      if (!kind) return;
      const attributes: Record<string, string> = { "data-draft-markdown": kind };
      if (marker && from === editedMark) attributes["data-editing-mark"] = "";
      ranges.push(
        Decoration.mark({
          class: marker ? styles.markdownMarker : styles.markdownText,
          attributes,
        }).range(from, to),
      );
    },
  });
  return Decoration.set(ranges, true);
}

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
      setEditedMark(composerMarkdownMarkAt(tree, position, position));
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
    if (marks.has(node.name)) {
      const raw = text.slice(node.from, node.to);
      const kind = markdownMarker(node, raw);
      if (!kind) return undefined;
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
    const format = markdownFormat(node);
    if (node.name === "Link" && !format) return undefined;
    const destination = format === "link" ? node.getChild("URL") : null;
    const rawUrl = destination ? text.slice(destination.from, destination.to) : "";
    const url = cachedUserLinkRanges(rawUrl).find(
      (range) => range.start === 0 && range.end === rawUrl.length,
    )?.link.url;
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
      <span
        className={styles.markdownText}
        data-draft-markdown={format}
        data-composer-reference={url ? "url" : undefined}
        data-reference-value={url}
      >
        {children}
      </span>
    ) : (
      children
    );
  }

  return paint(tree.topNode) ?? renderText(text);
}
