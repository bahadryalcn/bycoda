import type { Element, Root } from "hast";
import { parseLocalSessionLink } from "../model/localSessionReference";

const heldLinks = new WeakMap<Element, string>();

function eachLink(node: Root | Element, visit: (link: Element) => void) {
  for (const child of node.children) {
    if (child.type !== "element") continue;
    if (child.tagName === "a") visit(child);
    eachLink(child, visit);
  }
}

/** Runs after sanitizing. Harden sees only its ordinary safe placeholder URL. */
export function rehypeHoldLocalSessionLinks() {
  return (tree: Root) =>
    eachLink(tree, (link) => {
      const href = link.properties.href;
      if (typeof href !== "string" || !/^bycoda:/i.test(href)) return;
      if (!parseLocalSessionLink(href)) {
        delete link.properties.href;
        return;
      }
      heldLinks.set(link, href);
      link.properties.href = "/";
    });
}

export function rehypeRestoreLocalSessionLinks() {
  return (tree: Root) =>
    eachLink(tree, (link) => {
      const href = heldLinks.get(link);
      if (href === undefined) return;
      heldLinks.delete(link);
      link.properties.href = href;
      delete link.properties.target;
      delete link.properties.rel;
    });
}
