import type { Session } from "../../features/sessions/model/session";

/** A delayed save must read live state, never the snapshot that scheduled it. */
export function takePendingSessionWrites(
  pending: Map<string, Session>,
  current: readonly Session[],
): Session[] {
  const dirty = current.filter((session) => pending.has(session.id));
  pending.clear();
  return dirty;
}
