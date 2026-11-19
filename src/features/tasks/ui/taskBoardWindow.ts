import type { BoardTask } from "../model/taskClient";
import { taskCardKey } from "./taskBoardDrag";

/** Cards a column renders before "Load more"; Done and Blocked only ever grow. */
export const COLUMN_WINDOW = 40;

/** How many leading cards of a column to render. The window never hides a card the
 * owner is working with: each retained key (the open card, the focused card) widens
 * it to include that card, so selection, focus and keyboard moves keep their element. */
export function columnWindowSize(
  column: readonly BoardTask[],
  limit: number,
  retained: readonly (string | null | undefined)[],
): number {
  if (column.length <= limit) return column.length;
  let size = limit;
  for (const key of retained) {
    if (!key) continue;
    const index = column.findIndex((task) => taskCardKey(task) === key);
    if (index >= size) size = index + 1;
  }
  return size;
}
