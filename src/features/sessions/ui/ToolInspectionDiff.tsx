import { useLayoutEffect, useRef } from "react";
import { Text } from "../../../shared/ui/Text";

type Tone = "added" | "removed" | "inherit";
type Run = { from: number; to: number; tone: Tone };

/**
 * Keep the original line endings, joining neighboring lines with the same ink. The `--- a/…` and
 * `+++ b/…` file headers before the first hunk keep the plain ink; inside a hunk a removed
 * `-- comment` line is still a removal.
 */
export function diffRuns(text: string) {
  const runs: Run[] = [];
  let header = true;
  for (let from = 0; from < text.length;) {
    const newline = text.indexOf("\n", from);
    const to = newline < 0 ? text.length : newline + 1;
    const hunk = text.startsWith("@@", from);
    if (hunk || !/^(?:---|\+\+\+)(?: |\n|$)/.test(text.slice(from, from + 4))) header = false;
    const tone =
      header || hunk
        ? "inherit"
        : text[from] === "+"
          ? "added"
          : text[from] === "-"
            ? "removed"
            : "inherit";
    const previous = runs[runs.length - 1];
    if (previous?.tone === tone) previous.to = to;
    else runs.push({ from, to, tone });
    from = to;
  }
  return runs;
}

/** Ranges from other open tools share the document's two highlight names. */
function paintDiff(node: Node, text: string) {
  const byTone = { added: [] as StaticRange[], removed: [] as StaticRange[] };
  for (const { from, to, tone } of diffRuns(text)) {
    if (tone !== "inherit")
      byTone[tone].push(
        new StaticRange({
          startContainer: node,
          startOffset: from,
          endContainer: node,
          endOffset: to,
        }),
      );
  }
  const registry = node.ownerDocument!.defaultView!.CSS.highlights;
  const cleanups: (() => void)[] = [];
  for (const [tone, ranges] of Object.entries(byTone)) {
    if (!ranges.length) continue;
    const name = `bycoda-tool-diff-${tone}`;
    const existing = registry.get(name);
    const group = existing ?? new Highlight(...ranges);
    if (existing) for (const range of ranges) group.add(range);
    else registry.set(name, group);
    cleanups.push(() => {
      for (const range of ranges) group.delete(range);
      if (!group.size && registry.get(name) === group) registry.delete(name);
    });
  }
  return () => cleanups.forEach((cleanup) => cleanup());
}

/** Native selection and wrapping operate on one text node even in a line-alternating diff. */
export function ToolInspectionDiff({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const native =
    !!globalThis.CSS?.highlights &&
    typeof Highlight === "function" &&
    typeof StaticRange === "function";
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keep the document's highlight ranges attached to this revision of the saved diff.
  useLayoutEffect(() => {
    const node = ref.current?.firstChild;
    if (native && node) return paintDiff(node, text);
  }, [native, text]);
  if (native)
    return (
      <Text ref={ref} size="inherit" tone="inherit">
        {text}
      </Text>
    );
  return diffRuns(text).map(({ from, to, tone }) => (
    <Text key={from} size="inherit" tone={tone}>
      {text.slice(from, to)}
    </Text>
  ));
}
