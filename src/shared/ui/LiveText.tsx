import { useEffect, useState } from "react";

/**
 * Live region that renders the text as `role="status"` (or `alert` when assertive) and publishes it after mount,
 * so the first message is announced too. The text is also visible; style it with `className`.
 * @group feedback
 * @use Announce a changing result or status ("3 results", "Saved") that has no other live-region owner.
 * @avoid Transient confirmations with visible UI: Toast. Pending state: LoadingText. Never hand-write role="status" or aria-live.
 */
export function LiveText({
  text,
  className,
  mode = "polite",
}: {
  text: string;
  className?: string;
  mode?: "polite" | "assertive";
}) {
  const [announced, setAnnounced] = useState("");
  useEffect(() => setAnnounced(text), [text]);
  return (
    <span className={className} role={mode === "assertive" ? "alert" : "status"}>
      {announced}
    </span>
  );
}
