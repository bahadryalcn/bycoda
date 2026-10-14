import { markdownLanguage } from "@codemirror/lang-markdown";

/** Source ranges, not rendered HTML: editing a block preserves all other bytes. */
export function notePreviewBlocks(body: string) {
  const blocks: { from: number; to: number; text: string; definition: boolean }[] = [];
  const tree = markdownLanguage.parser.parse(body);
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

export function replacePreviewBlock(body: string, from: number, to: number, value: string) {
  return body.slice(0, from) + value + body.slice(to);
}
