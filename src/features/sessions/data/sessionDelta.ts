import type { Block } from "../model/session";

export type PersistedBlock = { source: Block; value: Block };
/** Compare immutable block references. Only changed values cross IPC. */
export function buildSessionBlockDelta(
  previous: readonly PersistedBlock[],
  next: readonly PersistedBlock[],
) {
  const changes: { index: number; block: Block }[] = [];
  for (let index = 0; index < next.length; index++) {
    if (
      previous[index]?.source !== next[index].source ||
      previous[index]?.value !== next[index].value
    ) {
      changes.push({ index, block: next[index].value });
    }
  }
  return { length: next.length, changes };
}
