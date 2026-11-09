/** A distant active item must stay reachable without mounting its whole prefix. */
export function folderSessionWindow<T extends { id: string }>(
  sessions: readonly T[],
  limit: number,
  activeId?: string | null,
): T[] {
  const count = Math.max(1, Math.floor(limit));
  const shown = sessions.slice(0, count);
  if (activeId && !shown.some((session) => session.id === activeId)) {
    const active = sessions.find((session) => session.id === activeId);
    if (active) shown.push(active);
  }
  return shown;
}
