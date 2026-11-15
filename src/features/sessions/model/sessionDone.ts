/** Sessions that finished while unfocused, until the user looks at them. */

export function nextUnseenFinishedSessions({
  previousBusyIds,
  busyIds,
  previousUnseenIds,
  focusedSessionId,
  untrackedIds,
  previousFailedIds,
  failedIds,
}: {
  previousBusyIds: ReadonlySet<string>;
  busyIds: ReadonlySet<string>;
  previousUnseenIds: ReadonlySet<string>;
  focusedSessionId?: string;
  /** Sessions the user cannot focus or see as done, such as orchestration
   * workers and inbox discussions. An unseen session stays loaded until it
   * is looked at, so marking one of these would keep it in memory for good. */
  untrackedIds?: ReadonlySet<string>;
  /** Sessions whose turn failed before and now; a newly failed one counts as finished. */
  previousFailedIds?: ReadonlySet<string>;
  failedIds?: ReadonlySet<string>;
}): Set<string> {
  const next = new Set(previousUnseenIds);
  for (const id of previousBusyIds) {
    if (!busyIds.has(id) && id !== focusedSessionId) next.add(id);
  }
  if (failedIds) {
    for (const id of failedIds) {
      if (!previousFailedIds?.has(id) && id !== focusedSessionId) next.add(id);
    }
  }
  for (const id of busyIds) next.delete(id);
  if (focusedSessionId) next.delete(focusedSessionId);
  if (untrackedIds) for (const id of untrackedIds) next.delete(id);
  return next;
}
