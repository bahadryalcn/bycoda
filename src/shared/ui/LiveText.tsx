import { useEffect, useState, type CSSProperties } from "react";
import { optionalTextAttributes, type TextRoles, type TextSize, type TextTone } from "./Text";

/**
 * Live region that renders the text as `role="status"` (or `alert` when assertive) and publishes it after mount,
 * so the first message is announced too. The text is also visible; set its type with `size`, `tone`, `weight`, `leading` and `truncate`, and place it with `className`.
 * @group feedback
 * @use Announce a changing result or status ("3 results", "Saved") that has no other live-region owner.
 * @avoid Transient confirmations with visible UI: Toast. Pending state: LoadingText. Never hand-write role="status" or aria-live.
 */
export function LiveText({
  text,
  className,
  size,
  tone,
  weight,
  leading,
  truncate,
  lines,
  mode = "polite",
}: {
  text: string;
  className?: string;
  /** Type size from the shared scale; unset keeps the surrounding size. */
  size?: TextSize;
  /** Ink; unset keeps the surrounding colour. */
  tone?: TextTone;
  /** Weight, line height and one-line ellipsis from the shared roles; unset keeps the surrounding type. */
  weight?: TextRoles["weight"];
  leading?: TextRoles["leading"];
  truncate?: boolean;
  /** Maximum visible lines without an extra wrapper; unset leaves wrapping unchanged. */
  lines?: number;
  mode?: "polite" | "assertive";
}) {
  const [announced, setAnnounced] = useState("");
  useEffect(() => setAnnounced(text), [text]);
  return (
    <span
      data-lines={lines || undefined}
      style={lines ? ({ "--clamp-lines": lines } as CSSProperties) : undefined}
      {...optionalTextAttributes(
        { size, tone, weight, leading, truncate: truncate || !!lines },
        className,
      )}
      role={mode === "assertive" ? "alert" : "status"}
    >
      {announced}
    </span>
  );
}
