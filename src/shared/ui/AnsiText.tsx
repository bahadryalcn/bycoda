import { useMemo } from "react";
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

/**
 * Terminal output with its color and weight escapes rendered as styled text.
 * Other control sequences are hidden. Place it inside a `<pre>` (or any
 * whitespace-preserving element); it renders inline spans only.
 * @group text
 * @use Command, log or tool output that may carry terminal color codes.
 * @avoid Interactive terminals: TerminalView. Search excerpts: terminalText. Copy text: stripAnsi.
 */
export function AnsiText({ text }: { text: string }) {
  const parts = useMemo(
    () =>
      parseAnsi(text).map((segment, index) => {
        const className = styleClass(segment.style);
        return className ? (
          <span key={index} className={className}>
            {segment.text}
          </span>
        ) : (
          segment.text
        );
      }),
    [text],
  );
  return <>{parts}</>;
}
