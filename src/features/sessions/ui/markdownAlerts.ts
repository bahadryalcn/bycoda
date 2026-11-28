import type { Element, ElementContent, Root } from "hast";

/** GitHub's alert kinds, written as `> [!NOTE]` on the first line of a quote. */
export type MarkdownAlertKind = "note" | "tip" | "important" | "warning" | "caution";

const MARKER = /^\s*\[!(note|tip|important|warning|caution)\][ \t]*(?:\r?\n)?/i;

const isBlank = (node: ElementContent) =>
  (node.type === "text" && !node.value.trim()) ||
  (node.type === "element" && node.tagName === "br");

/** Turns a quote that opens with `[!NOTE]` and its kin into an alert: the marker goes, its kind stays. */
function markAlert(quote: Element) {
  const first = quote.children.find((child) => !(child.type === "text" && !child.value.trim()));
  if (first?.type !== "element" || first.tagName !== "p") return;
  const lead = first.children[0];
  if (lead?.type !== "text") return;
  const match = MARKER.exec(lead.value);
  if (!match) return;
  lead.value = lead.value.slice(match[0].length);
  // The marker's own line ends in a break or a newline; the body starts after it.
  while (first.children[0] && isBlank(first.children[0])) first.children.shift();
  const next = first.children[0];
  if (next?.type === "text") next.value = next.value.replace(/^\s+/, "");
  if (!first.children.length) quote.children.splice(quote.children.indexOf(first), 1);
  quote.properties = {
    ...quote.properties,
    dataMarkdownAlert: match[1]!.toLowerCase() as MarkdownAlertKind,
  };
}

function visit(node: Root | Element) {
  for (const child of node.children) {
    if (child.type !== "element") continue;
    if (child.tagName === "blockquote") markAlert(child);
    visit(child);
  }
}

/** Runs after sanitizing, so the alert kind it sets is app data, never author markup. */
export function rehypeMarkdownAlerts() {
  return (tree: Root) => visit(tree);
}
