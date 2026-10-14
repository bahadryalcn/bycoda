import type { Block, Session } from "./session";
import { wasTurnInterrupted } from "./inFlight";

/**
 * What became of a turn that was mid-flight when Bycoda went away.
 *
 * "Continue from where you left off." is only right for a turn that was cut
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

/**
 * The transcript of a turn that finished while the app was closed: the quit
 * note goes (the turn was not cut off after all) and the final reply is added
 * unless the turn already holds it (the steps rebuilt from the transcript
 * include it).
 */
export function withFinishedTurn(session: Session, finalText: string | undefined): Session {
  let blocks: Block[] = wasTurnInterrupted(session) ? session.blocks.slice(0, -1) : session.blocks;
  const text = finalText?.trim();
  if (text && !turnHasAssistantText(blocks, text)) {
    blocks = [...blocks, { id: crypto.randomUUID(), role: "assistant", text }];
  }
  return blocks === session.blocks ? session : { ...session, blocks };
}

/** The turn (everything after the last user block) already holds this reply. */
function turnHasAssistantText(blocks: Block[], text: string): boolean {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block.role === "assistant" && block.text.trim() === text) return true;
    if (block.role === "user") return false;
  }
  return false;
}
