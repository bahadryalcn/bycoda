import { useState } from "react";

/** Which fields the person has left, so a required-field message shows beside the field only after they visited it. */
export function useTouched(): { touched: (key: string) => boolean; touch: (key: string) => void } {
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
  return {
    touched: (key) => seen.has(key),
    touch: (key) => setSeen((current) => (current.has(key) ? current : new Set(current).add(key))),
  };
}
