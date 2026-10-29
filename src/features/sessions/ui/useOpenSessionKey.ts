import { useState } from "react";

/**
 * Reset key for per-open state (keyboard row, submenu level) of a toggled popup.
 *
 * Every transition to open starts a new session, so state keyed on it starts fresh on each
 * open, including when the same selection is reopened. While closed the key is constant.
 */
export function useOpenSessionKey(open: boolean): string {
  const [tracked, setTracked] = useState({ open, session: 0 });
  if (tracked.open !== open) {
    setTracked({ open, session: open ? tracked.session + 1 : tracked.session });
  }
  return open ? `open-${tracked.session + (tracked.open === open ? 0 : 1)}` : "closed";
}
