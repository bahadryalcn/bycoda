import type { AssistantAutomaticPresence } from "../../../src/shared/model/host-contracts/assistant";

export type AssistantPresenceObservation = { supported: boolean; locked: boolean; idleMs?: number };

/** A missing or failed reader never implies present: it reports a locked, unsupported desktop. */
export async function readAssistantPresence(
  read: (() => Promise<AssistantPresenceObservation>) | undefined,
): Promise<AssistantPresenceObservation> {
  try {
    return (await read?.()) ?? { supported: false, locked: true };
  } catch {
    return { supported: false, locked: true };
  }
}

/**
 * Classifies one desktop observation against the owner's idle and away thresholds. A desktop
 * that could not be read is away: the owner is always present, idle, away or busy.
 */
export function assistantPresenceState(
  observation: AssistantPresenceObservation,
  policy: { idleMinutes: number; awayMinutes: number },
): { state: AssistantAutomaticPresence["state"]; idleMs?: number } {
  const idleMs =
    Number.isSafeInteger(observation.idleMs) && observation.idleMs! >= 0
      ? observation.idleMs
      : undefined;
  const state: AssistantAutomaticPresence["state"] = !observation.supported
    ? "away"
    : observation.locked
      ? "locked"
      : idleMs === undefined
        ? "away"
        : idleMs >= policy.awayMinutes * 60000
          ? "away"
          : idleMs >= policy.idleMinutes * 60000
            ? "idle"
            : "present";
  return idleMs === undefined ? { state } : { state, idleMs };
}
