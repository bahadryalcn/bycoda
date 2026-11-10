const PREFIX = "delegated:";

/** Id of the transcript block that stands for one delegated child session. */
export function delegatedBlockId(sessionId: string): string {
  return `${PREFIX}${sessionId}`;
}

/** The child session a delegated block id names, or undefined for any other block. */
export function delegatedChildIdOf(blockId: string): string | undefined {
  return blockId.startsWith(PREFIX) ? blockId.slice(PREFIX.length) || undefined : undefined;
}
