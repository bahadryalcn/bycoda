import { markdownLanguage } from "@codemirror/lang-markdown";
import { TreeFragment, type Tree } from "@lezer/common";

type PreviewBlock = { from: number; to: number; text: string; definition: boolean };
export type NotePreviewBlock = PreviewBlock & { key: number };

function blocksFromTree(body: string, tree: Tree): PreviewBlock[] {
  const blocks: PreviewBlock[] = [];
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    blocks.push({
      from: node.from,
      to: node.to,
      text: body.slice(node.from, node.to),
      definition: node.name === "LinkReference",
    });
  }
  return blocks;
}

/** Source ranges, not rendered HTML: editing a block preserves all other bytes. */
export function notePreviewBlocks(body: string) {
  return blocksFromTree(body, markdownLanguage.parser.parse(body));
}

/** A preview owns one incremental tree; no global cache of note bodies is retained. */
export class NotePreviewParser {
  private body = "";
  private tree?: Tree;
  private blocks: NotePreviewBlock[] = [];
  private nextKey = 0;

  parse(body: string): NotePreviewBlock[] {
    if (this.tree && body === this.body) return this.blocks;
    let from = 0;
    const limit = Math.min(body.length, this.body.length);
    while (from < limit && body[from] === this.body[from]) from += 1;
    let toA = this.body.length;
    let toB = body.length;
    while (toA > from && toB > from && this.body[toA - 1] === body[toB - 1]) {
      toA -= 1;
      toB -= 1;
    }
    const fragments = this.tree
      ? TreeFragment.applyChanges(TreeFragment.addTree(this.tree), [
          { fromA: from, toA, fromB: from, toB },
        ])
      : [];
    const tree = markdownLanguage.parser.parse(body, fragments);
    const raw = blocksFromTree(body, tree);
    const previous = this.blocks;
    const equal = (left: PreviewBlock, right: PreviewBlock) =>
      left.text === right.text && left.definition === right.definition;
    let prefix = 0;
    while (prefix < Math.min(raw.length, previous.length) && equal(raw[prefix], previous[prefix]))
      prefix += 1;
    let suffix = 0;
    while (
      suffix < Math.min(raw.length, previous.length) - prefix &&
      equal(raw[raw.length - 1 - suffix], previous[previous.length - 1 - suffix])
    )
      suffix += 1;
    this.blocks = raw.map((block, index) => {
      const old =
        index < prefix
          ? previous[index]
          : index >= raw.length - suffix
            ? previous[previous.length - raw.length + index]
            : undefined;
      return old && old.from === block.from && old.to === block.to
        ? old
        : { ...block, key: old?.key ?? this.nextKey++ };
    });
    this.body = body;
    this.tree = tree;
    return this.blocks;
  }
}

// Match CommonMark's identifier folding. Non-Markdown whitespace (e.g. NBSP)
// remains significant, and lower+upper handles Unicode case-fold equivalents.
const referenceKey = (label: string) =>
  label
    .replace(/[\t\n\r ]+/g, " ")
    .replace(/^ | $/g, "")
    .toLowerCase()
    .toUpperCase();

/** Keep full Markdown semantics for complex escaped/entity labels, cheaply filter ordinary references. */
export function notePreviewReferences(blocks: readonly PreviewBlock[]) {
  const definitions = blocks.filter((block) => block.definition).map((block) => block.text);
  const all = definitions.join("\n");
  const byLabel = new Map<string, string>();
  let complex = false;
  for (const definition of definitions) {
    const match = /^\s*\[((?:\\.|[^\]\\])*)\]:/.exec(definition);
    if (!match || /[\\&]/.test(match[1])) {
      complex = true;
      continue;
    }
    const key = referenceKey(match[1]);
    if (!byLabel.has(key)) byLabel.set(key, definition);
  }
  return (text: string) => {
    if (!all || complex || /[\\&]/.test(text)) return all;
    const needed = new Set<string>();
    for (const match of text.matchAll(/\[((?:\\.|[^\]\\])*)\]/g))
      needed.add(referenceKey(match[1]));
    return [...needed]
      .map((key) => byLabel.get(key))
      .filter(Boolean)
      .join("\n");
  };
}

export function replacePreviewBlock(body: string, from: number, to: number, value: string) {
  return body.slice(0, from) + value + body.slice(to);
}
