import { useEffect, useState } from "react";

/** Mount the live region before publishing its first message. */
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
