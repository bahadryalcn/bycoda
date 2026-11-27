import type { Session } from "./session";

/**
 * What became of a turn that was mid-flight when Bycoda went away.
 *
 * CONTINUE_PROMPT is only right for a turn that was cut
 * off. A turn that is still running must be left alone, and one that finished
 * while the app was closed must just be shown. This module is the one place
 * that decides which, from facts the caller gathered; it does no I/O.
 */

/** The end of the provider's own transcript, as `probe_turn_tail` reports it. */
export type TurnTailState = "ended" | "open" | "unknown" | "missing";

export type TurnRecoveryInput = {
  /** The session was recorded as mid-turn (busy or awaiting input) at the last write. */
  wasInFlight: boolean;
  /**
   * Whether the process (or remote host turn) doing the work is alive.
   * "unknown" when it cannot be told.
   */
  liveness: "alive" | "dead" | "unknown";
  /** Background commands or agents the turn was waiting on are still running. */
  backgroundWorkAlive: boolean;
  /** `unsupported` for providers whose transcript is not read. */
  transcript: TurnTailState | "unsupported";
};

export type TurnRecovery = {
  state: "running" | "finished" | "interrupted";
  /**
   * False when the facts do not settle it. An uncertain `interrupted` is shown
   * to the user to decide; it is never sent automatically.
   */
  certain: boolean;
};

export function classifyTurnRecovery(input: TurnRecoveryInput): TurnRecovery {
  if (!input.wasInFlight) return { state: "finished", certain: true };
  // Alive work, background work included, is running: never interrupted.
  if (input.liveness === "alive" || input.backgroundWorkAlive) {
    return { state: "running", certain: true };
  }
  if (input.transcript === "ended") return { state: "finished", certain: true };
  if (input.transcript === "open" && input.liveness === "dead") {
    return { state: "interrupted", certain: true };
  }
  // No transcript to read, an ambiguous tail, or no way to tell whether the
  // process is gone: do not guess.
  return { state: "interrupted", certain: false };
}

export function shouldAutoContinue(input: {
  recovery: TurnRecovery;
  /** The "Automatically continue interrupted turns" setting. */
  enabled: boolean;
  queuedCount: number;
}): boolean {
  // With follow-ups queued the user already said what comes next. Sending the
  // continue prompt over them would be a guess, so the queue waits for them
  // (restored, with "Send next") and the interrupted note offers Continue.
  return (
    input.enabled &&
    input.recovery.state === "interrupted" &&
    input.recovery.certain &&
    input.queuedCount === 0
  );
}

/** This interruption has not had its one launch that may continue it automatically. */
export function isAutoContinueArmed(session: Session): boolean {
  return session.blocks[session.blocks.length - 1]?.autoContinueArmed === true;
}

/** Later launches leave this interruption to the user's Continue. */
export function disarmAutoContinue(session: Session): Session {
  const last = session.blocks[session.blocks.length - 1];
  if (!last?.autoContinueArmed) return session;
  const { autoContinueArmed: _spent, ...note } = last;
  return { ...session, blocks: [...session.blocks.slice(0, -1), note] };
}
