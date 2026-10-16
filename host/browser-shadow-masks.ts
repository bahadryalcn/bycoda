/** Retain structural node information only. Attributes and shadow contents
 * never enter annotation metadata. */
export type BrowserDomNode = {
  nodeType: number;
  localName?: string;
  children?: BrowserDomNode[];
  shadowRoots?: { shadowRootType?: string }[];
};
export function browserShadowMasks(root: BrowserDomNode): string[] {
  const masks: string[] = [];
  let visited = 0;
  function visit(node: BrowserDomNode, path: string[]) {
    if (++visited > 20_000 || path.length > 64)
      throw new Error("Page exceeds safe inspection budget");
    if (node.shadowRoots?.some((shadow) => shadow.shadowRootType !== "user-agent"))
      masks.push(path.join(" > "));
    const siblings = new Map<string, number>();
    for (const child of node.children ?? []) {
      if (child.nodeType !== 1) continue;
      const tag = child.localName ?? "";
      if (!/^[a-zA-Z][\w-]*$/.test(tag)) throw new Error("Element cannot be safely inspected");
      const index = (siblings.get(tag) ?? 0) + 1;
      siblings.set(tag, index);
      visit(child, [...path, `${tag}:nth-of-type(${index})`]);
    }
  }
  visit(root, []);
  if (masks.length > 512 || masks.join(",").length > 65_536)
    throw new Error("Page exceeds safe redaction budget");
  return masks;
}
