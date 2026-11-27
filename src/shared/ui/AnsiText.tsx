import { useLayoutEffect, useRef, useState } from "react";
import { parseAnsi, type AnsiStyle } from "../lib/ansi";

// Terminal colors map to theme tones so output follows light and dark themes.
// Index order: black, red, green, yellow, blue, magenta, cyan, white, then bright.
const FG = [
  "text-(--ui-text-muted)",
  "text-(--ui-tone-danger-fg)",
  "text-(--ui-tone-success-fg)",
  "text-(--ui-tone-warning-fg)",
  "text-(--ui-tone-info-fg)",
  "text-(--ui-tone-accent-fg)",
  "text-(--ui-tone-info-fg)",
  "text-(--ui-text)",
];
const BG = [
  "bg-(--ui-tone-neutral-subtle)",
  "bg-(--ui-tone-danger-subtle)",
  "bg-(--ui-tone-success-subtle)",
  "bg-(--ui-tone-warning-subtle)",
  "bg-(--ui-tone-info-subtle)",
  "bg-(--ui-tone-accent-subtle)",
  "bg-(--ui-tone-info-subtle)",
  "bg-(--ui-tone-neutral-subtle)",
];

function styleClass(style: AnsiStyle): string {
  const classes: string[] = [];
  if (style.fg !== undefined) classes.push(FG[style.fg % 8]);
  if (style.bg !== undefined) classes.push(BG[style.bg % 8]);
  if (style.bold) classes.push("font-semibold");
  if (style.dim) classes.push("opacity-70");
  if (style.italic) classes.push("italic");
  if (style.underline) classes.push("underline");
  if (style.strike) classes.push("line-through");
  return classes.join(" ");
}

const SHIFT_PROBE = 8;
const SHIFT_CANDIDATES = 16;

/**
 * How many leading characters of `prev` were dropped when `next` is the same stream with its
 * head cut off (and maybe more appended), or 0 when the two are unrelated or what stays is
 * shorter than a probe.
 */
function droppedHead(prev: string, next: string): number {
  const probe = next.slice(0, SHIFT_PROBE);
  // What stays is a prefix of `next`, so it is no longer than `next`.
  let at = prev.indexOf(probe, Math.max(1, prev.length - next.length));
  for (let tries = 0; at > 0 && tries < SHIFT_CANDIDATES; tries++) {
    if (next.startsWith(prev.slice(at))) return at;
    at = prev.indexOf(probe, at + 1);
  }
  return 0;
}

/**
 * Brings a rendered text node to `next` through the smallest edit. Replacing the whole value
 * collapses a browser selection inside the node; appending and dropping the head keep the
 * offsets of what stays, so a reader's selection survives streaming output.
 */
function syncText(node: Text, next: string) {
  const prev = node.data;
  if (prev === next) return;
  if (next.startsWith(prev)) {
    node.appendData(next.slice(prev.length));
    return;
  }
  const dropped = droppedHead(prev, next);
  if (dropped > 0) {
    node.deleteData(0, dropped);
    node.appendData(next.slice(prev.length - dropped));
    return;
  }
  node.data = next;
}

/**
 * One styled run. React renders the first text only; later text is applied to the live node
 * so streamed output grows in place instead of replacing the node.
 */
function AnsiRun({ text, className }: { text: string; className: string }) {
  const element = useRef<HTMLSpanElement>(null);
  const [initial] = useState(text);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- keeps the live DOM text node in step with `text` by editing it in place, before paint, so a browser selection inside it survives streaming.
  useLayoutEffect(() => {
    const host = element.current;
    if (!host) return;
    const node = host.firstChild;
    if (node instanceof Text) syncText(node, text);
    else host.textContent = text;
  }, [text]);
  return (
    <span ref={element} className={className || undefined}>
      {initial}
    </span>
  );
}

/**
 * Terminal output with its color and weight escapes rendered as styled text.
 * Other control sequences are hidden. Place it inside a `<pre>` (or any
 * whitespace-preserving element); it renders inline spans only. Appended text grows the
 * existing text in place, so a selection inside streaming output is kept.
 * @group text
 * @use Command, log or tool output that may carry terminal color codes.
 * @avoid Interactive terminals: TerminalView. Search excerpts: terminalText. Copy text: stripAnsi. Plain output without escape codes: OutputBlock.
 */
export function AnsiText({ text }: { text: string }) {
  return (
    <>
      {parseAnsi(text).map((segment, index) => (
        <AnsiRun key={index} text={segment.text} className={styleClass(segment.style)} />
      ))}
    </>
  );
}
