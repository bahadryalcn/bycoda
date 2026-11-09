import type { Root, RootContent } from "mdast";
import { parseLocalSessionLink } from "../model/localSessionReference";

/** Copied plain references are actionable too; code and existing links stay literal. */
export function remarkLocalSessionLinks() {
  return (tree: Root) => {
    function visit(parent: { children: RootContent[] }) {
      parent.children = parent.children.flatMap((node): RootContent[] => {
        if (node.type === "text") {
          const output: RootContent[] = [];
          const pattern =
            /\b(?:bycoda:\/\/session|https:\/\/link\.bycoda\.codes\/session)\/[^\s<>`]+/g;
          let offset = 0;
          for (const match of node.value.matchAll(pattern)) {
            const candidate = match[0];
            const href = parseLocalSessionLink(candidate)
              ? candidate
              : candidate.replace(/[.,;!?)\]]+$/, "");
            if (!parseLocalSessionLink(href)) continue;
            const index = match.index!;
            if (index > offset)
              output.push({ type: "text", value: node.value.slice(offset, index) });
            output.push({ type: "link", url: href, children: [{ type: "text", value: href }] });
            offset = index + href.length;
          }
          if (!output.length) return [node];
          if (offset < node.value.length)
            output.push({ type: "text", value: node.value.slice(offset) });
          return output;
        }
        if (node.type !== "link" && node.type !== "linkReference" && "children" in node)
          visit(node as { children: RootContent[] });
        return [node];
      });
    }
    visit(tree);
  };
}
