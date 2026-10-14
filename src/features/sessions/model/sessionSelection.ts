export function toggleSessionSelection(
  selected: ReadonlySet<string>,
  sessionId: string,
): Set<string> {
  const next = new Set(selected);
  if (next.has(sessionId)) next.delete(sessionId);
  else next.add(sessionId);
  return next;
}

export function orderedSessionActionIds(
  clickedSessionId: string,
  selected: ReadonlySet<string>,
  orderedSessionIds: readonly string[],
): string[] {
  if (!selected.has(clickedSessionId) || selected.size <= 1) {
    return [clickedSessionId];
  }
  const ordered = orderedSessionIds.filter((id) => selected.has(id));
  return ordered.length > 0 ? ordered : [clickedSessionId];
}

export function pruneSessionSelection(
  selected: ReadonlySet<string>,
  availableSessionIds: ReadonlySet<string>,
): Set<string> {
  const next = new Set([...selected].filter((sessionId) => availableSessionIds.has(sessionId)));
  if (next.size !== selected.size) return next;
  for (const sessionId of next) {
    if (!selected.has(sessionId)) return next;
  }
  return selected as Set<string>;
}

/** Inclusive run between the anchor and the target, in list order. */
export function sessionSelectionRange(
  orderedSessionIds: readonly string[],
  anchorSessionId: string,
  targetSessionId: string,
): string[] {
  const start = orderedSessionIds.indexOf(anchorSessionId);
  const end = orderedSessionIds.indexOf(targetSessionId);
  if (start < 0 || end < 0) return [targetSessionId];
  return orderedSessionIds.slice(Math.min(start, end), Math.max(start, end) + 1);
}

export function selectAllSessions(
  selected: ReadonlySet<string>,
  orderedSessionIds: readonly string[],
): Set<string> {
  if (
    selected.size === orderedSessionIds.length &&
    orderedSessionIds.every((id) => selected.has(id))
  ) {
    return selected as Set<string>;
  }
  return new Set(orderedSessionIds);
}
