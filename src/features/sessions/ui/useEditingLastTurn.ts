import { useState } from "react";

/**
 * Whether the earlier turn is being edited and resent. One owner holds it: the
 * session pane, or a standalone Composer when no pane supplies it. The flag is
 * dropped during render whenever the session or the edit capability changes, so
 * a stale edit marker never survives into another conversation.
 */
export function useEditingLastTurn(
  sessionId: string | undefined,
  supported: boolean,
): readonly [editing: boolean, setEditing: (editing: boolean) => void] {
  const [state, setState] = useState({ sessionId, supported, editing: false });
  let current = state;
  if (state.sessionId !== sessionId || state.supported !== supported) {
    current = { sessionId, supported, editing: false };
    setState(current);
  }
  const setEditing = (editing: boolean) =>
    setState((previous) => (previous.editing === editing ? previous : { ...previous, editing }));
  return [current.editing, setEditing];
}
