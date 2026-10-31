import type { HarnessId } from "../../../features/sessions/model/session";

/** What a provider handoff is waiting for, so "Preparing a handoff" can say so. */
export type HandoffPhase = "summarizing" | "stopping";

const phases = new Map<HarnessId, { phase: HandoffPhase; count: number }>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of [...listeners]) listener();
}

/**
 * Marks the outgoing provider as being summarized or stopped. Returns the function
 * that ends the phase. Keyed by the outgoing provider, which is what the handoff
 * divider knows; two handoffs from the same provider share the label.
 */
export function beginHandoffPhase(
  harness: HarnessId,
  phase: HandoffPhase,
): () => void {
  const current = phases.get(harness);
  phases.set(harness, { phase, count: (current?.count ?? 0) + 1 });
  notify();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    const entry = phases.get(harness);
    if (!entry) return;
    if (entry.count > 1)
      phases.set(harness, { ...entry, count: entry.count - 1 });
    else phases.delete(harness);
    notify();
  };
}

export function handoffPhaseOf(harness: HarnessId): HandoffPhase | undefined {
  return phases.get(harness)?.phase;
}

export function subscribeHandoffPhase(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
