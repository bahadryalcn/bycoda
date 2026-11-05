type TurnNotice = { role?: unknown; notice?: unknown; text?: unknown };

/** Older transcripts used the same notice kind for owner Stop and lost execution. */
export function isOwnerStopNotice(block: TurnNotice | null | undefined): boolean {
  return (
    block?.role === "system" &&
    typeof block.text === "string" &&
    block.text.trim() === "Stopped by you."
  );
}

/** A former quit handler could append its marker after an already completed Stop. */
export function isOwnerStoppedTurn(blocks: readonly TurnNotice[]): boolean {
  const last = blocks[blocks.length - 1];
  return (
    isOwnerStopNotice(last) ||
    (last?.role === "system" &&
      (last.text === "Turn interrupted when bycoda quit." ||
        last.text === "Turn interrupted when Bycoda quit.") &&
      isOwnerStopNotice(blocks[blocks.length - 2]))
  );
}

/** A deliberate Stop is terminal, but must not advertise interruption or auto-resume. */
export function isTurnInterruptionNotice(block: TurnNotice | null | undefined): boolean {
  return (
    block?.role === "system" &&
    !isOwnerStopNotice(block) &&
    (block.notice === "interrupt" ||
      block.text === "Turn interrupted when bycoda quit." ||
      block.text === "Turn interrupted when Bycoda quit.")
  );
}
