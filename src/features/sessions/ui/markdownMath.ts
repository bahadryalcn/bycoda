import type { Root } from "mdast";

type MdNode = {
  type: string;
  value?: string;
  children?: MdNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

/**
 * `$...$` math follows GitHub's rule: the opening `$` is not followed by a space, the closing one is
 * not preceded by a space nor followed by a digit. Prices and shell variables in prose
 * (`$5 and $10`, `$3 / $15`, `$HOME and $PATH`) therefore stay text. `$$...$$` is always math.
 * shortcut: a reverted span returns as plain text, so Markdown inside it (`$5 **and** $`) shows
 * its markers; parse single-dollar math with these rules in the tokenizer if that ever matters.
 */
function guard(parent: MdNode) {
  const children = parent.children;
  if (!children) return;
  children.forEach((node, index) => {
    if (node.type !== "inlineMath") return guard(node);
    const value = node.value ?? "";
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    const fence = (end - start - value.length) / 2;
    if (fence !== 1) return;
    const after = children[index + 1];
    const tight =
      !!value &&
      !/^\s/.test(value) &&
      !/\s$/.test(value) &&
      !(after?.type === "text" && /^\d/.test(after.value ?? ""));
    if (!tight) children[index] = { type: "text", value: `$${value}$` };
  });
}

export function remarkGuardSingleDollarMath() {
  return (tree: Root) => guard(tree as unknown as MdNode);
}
