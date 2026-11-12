import { parser } from "@lezer/markdown";

export type JiraCommentImage = {
  id: string;
  name: string;
  type: string;
  dataUrl: string;
  uploaded?: { key: string; id: string; url: string };
};
export const JIRA_IMAGE_LIMIT = 10 * 1024 * 1024;
export const JIRA_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
type Node = ReturnType<typeof parser.parse>["topNode"];
type Adf = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Adf[];
  content?: Adf[];
};

/** Parse with the same CommonMark grammar as the Notes editor; never interpret HTML. */
export function jiraCommentDocument(markdown: string, images: JiraCommentImage[] = []) {
  markdown = markdown.replace(/\r\n?/g, "\n");
  const text = (value: string, marks: Adf[] = [], code = false): Adf[] => {
    if (!value) return [];
    if (code) return [{ type: "text", text: value }];
    return value
      .split("\n")
      .flatMap((line, index): Adf[] => [
        ...(index ? [{ type: "hardBreak" }] : []),
        ...(line ? [{ type: "text", text: line, ...(marks.length ? { marks } : {}) }] : []),
      ]);
  };
  const source = (node: Node) => markdown.slice(node.from, node.to);
  const children = (node: Node, marks: Adf[] = []): Adf[] => {
    const result: Adf[] = [];
    let offset = node.from;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      result.push(...text(markdown.slice(offset, child.from), marks), ...convert(child, marks));
      offset = child.to;
    }
    result.push(...text(markdown.slice(offset, node.to), marks));
    return result;
  };
  const convert = (node: Node, marks: Adf[] = []): Adf[] => {
    if (
      ["EmphasisMark", "CodeMark", "LinkMark", "ListMark", "QuoteMark", "HeaderMark"].includes(
        node.name,
      )
    )
      return [];
    if (node.name === "StrongEmphasis" || node.name === "Emphasis")
      return children(node, [...marks, { type: node.name === "StrongEmphasis" ? "strong" : "em" }]);
    if (node.name === "InlineCode")
      return text(
        source(node)
          .replace(/^`+|`+$/g, "")
          .replace(/\n/g, " "),
        [{ type: "code" }],
      );
    if (node.name === "Link") {
      const url = node.getChild("URL");
      const href = url ? source(url) : "";
      const label = source(node).match(/^\[([\s\S]*?)\]/)?.[1] ?? source(node);
      return text(
        label,
        /^(https?:|mailto:)/i.test(href) ? [...marks, { type: "link", attrs: { href } }] : marks,
      );
    }
    if (node.name === "HardBreak") return [{ type: "hardBreak" }];
    if (node.name === "FencedCode" || node.name === "CodeBlock") {
      const code = node.getChildren("CodeText").map(source).join("\n");
      return [{ type: "codeBlock", content: text(code, [], true) }];
    }
    const block: Record<string, string> = {
      Document: "doc",
      Paragraph: "paragraph",
      BulletList: "bulletList",
      OrderedList: "orderedList",
      ListItem: "listItem",
      Blockquote: "blockquote",
    };
    if (block[node.name]) {
      const content: Adf[] = [];
      for (let child = node.firstChild; child; child = child.nextSibling)
        content.push(...convert(child, marks));
      // Paragraph text between inline syntax nodes must remain intact.
      return [
        {
          type: block[node.name],
          content: node.name === "Paragraph" ? children(node, marks) : content,
        },
      ];
    }
    if (node.name.startsWith("ATXHeading"))
      return [{ type: "paragraph", content: children(node, marks) }];
    return text(source(node), marks);
  };
  const doc = convert(parser.parse(markdown).topNode)[0];
  for (const image of images) {
    if (!image.uploaded) throw new Error("Image upload has not completed");
    doc.content!.push({
      type: "paragraph",
      content: text(image.name, [{ type: "link", attrs: { href: image.uploaded.url } }]),
    });
  }
  return { ...doc, version: 1 };
}
