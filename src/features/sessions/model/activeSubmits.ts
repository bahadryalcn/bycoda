import { cancelHandoff, isPreparingHandoff } from "./handoff";
import { sessionsRef, setSessions } from "./sessionsStore";

// Latest submit generation that is still running per session. A "Preparing a
// handoff" block with no running submit behind it can never finish by itself.
const active = new Map<string, number>();

export function beginActiveSubmit(sessionId: string, gen: number): void {
  active.set(sessionId, gen);
}

export function hasActiveSubmit(sessionId: string): boolean {
  return active.has(sessionId);
}

/** Ends submit `gen`; false when a newer submit already owns the session. */
export function endActiveSubmit(sessionId: string, gen: number): boolean {
  if (active.get(sessionId) !== gen) return false;
  active.delete(sessionId);
  return true;
}

/** Cancels a preparing handoff that no running submit owns. True when one was repaired. */
export function repairStaleHandoff(sessionId: string): boolean {
  const session = sessionsRef.current.find((entry) => entry.id === sessionId);
  if (!session || !isPreparingHandoff(session) || hasActiveSubmit(sessionId)) return false;
  setSessions((prev) =>
    prev.map((entry) =>
      entry.id === sessionId && isPreparingHandoff(entry) && !hasActiveSubmit(sessionId)
        ? cancelHandoff(entry)
        : entry,
    ),
  );
  return true;
}
