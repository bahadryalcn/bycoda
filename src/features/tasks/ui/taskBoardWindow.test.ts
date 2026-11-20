import { expect, it } from "vitest";
import type { BoardTask } from "../model/taskClient";
import { createTaskBoardDrag } from "./taskBoardDrag";
import { COLUMN_WINDOW, columnWindowSize } from "./taskBoardWindow";

const column = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ machineId: "m", id: `t${index}` }) as BoardTask);

it("renders a short column whole and a long one up to the window", () => {
  expect(columnWindowSize(column(5), COLUMN_WINDOW, [])).toBe(5);
  expect(columnWindowSize(column(COLUMN_WINDOW + 30), COLUMN_WINDOW, [])).toBe(COLUMN_WINDOW);
});

it("widens the window to keep the open and the focused card rendered", () => {
  const long = column(COLUMN_WINDOW + 30);
  expect(columnWindowSize(long, COLUMN_WINDOW, [`m:t${COLUMN_WINDOW + 4}`])).toBe(
    COLUMN_WINDOW + 5,
  );
  expect(columnWindowSize(long, COLUMN_WINDOW, ["m:t1", null, "m:missing"])).toBe(COLUMN_WINDOW);
});

it("notifies the drag store only when a cue actually changes", () => {
  const drag = createTaskBoardDrag();
  let notifications = 0;
  drag.subscribe(() => notifications++);
  drag.set({ draggedKey: "m:a" });
  drag.set({ dropColumn: "todo", dropBeforeKey: "m:b" });
  drag.set({ dropColumn: "todo", dropBeforeKey: "m:b" });
  expect(notifications).toBe(2);
  drag.end();
  drag.end();
  expect(notifications).toBe(3);
  expect(drag.get()).toEqual({ draggedKey: null, dropColumn: null, dropBeforeKey: null });
});
