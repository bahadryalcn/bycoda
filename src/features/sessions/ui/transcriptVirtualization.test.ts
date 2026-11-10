// @vitest-environment jsdom
import { expect, it } from "vitest";
import { TranscriptVirtualization } from "./transcriptVirtualization";

const ROW = 20;
const ROWS_PER_TURN = 5;
const VIEWPORT = 100;

/** A transcript of stacked turns scrolled by `offset`, counting row rect reads. */
function transcript(turns: number, offset: number) {
  const owner = new TranscriptVirtualization();
  const scroll = document.createElement("div");
  scroll.className = "agent-transcript";
  Object.defineProperty(scroll, "clientHeight", { value: VIEWPORT });
  const rect = (top: number, height: number) =>
    ({ top: top - offset, bottom: top + height - offset, height }) as DOMRect;
  scroll.getBoundingClientRect = () => rect(offset, VIEWPORT);
  let reads = 0;
  for (let turn = 0; turn < turns; turn++) {
    const element = document.createElement("div");
    element.dataset.transcriptTurn = `turn-${turn}`;
    element.getBoundingClientRect = () => rect(turn * ROWS_PER_TURN * ROW, ROWS_PER_TURN * ROW);
    for (let row = 0; row < ROWS_PER_TURN; row++) {
      const node = document.createElement("div");
      const index = turn * ROWS_PER_TURN + row;
      node.dataset.transcriptVirtualBlockId = `row-${index}`;
      node.getBoundingClientRect = () => {
        reads++;
        return rect(index * ROW, ROW);
      };
      owner.rowScroll.set(node, scroll);
      element.append(node);
    }
    scroll.append(element);
  }
  document.body.append(scroll);
  return { owner, scroll, reads: () => reads };
}

it("finds the first visible row without measuring the turns above the viewport", () => {
  // 40 turns of 5 rows; the viewport starts inside turn 37, two rows down.
  const { owner, scroll, reads } = transcript(40, 37 * ROWS_PER_TURN * ROW + 2 * ROW + 5);

  const row = owner.firstVisibleRow(scroll);

  expect(row?.dataset.transcriptVirtualBlockId).toBe(`row-${37 * ROWS_PER_TURN + 2}`);
  // A scroll event runs this on every frame of a panel drag: reading every row
  // above the viewport made its cost grow with the length of the conversation.
  expect(reads()).toBeLessThan(ROWS_PER_TURN * 2);
});

it("still finds the row when the viewport starts in the first turn", () => {
  const { owner, scroll } = transcript(3, ROW + 5);

  expect(owner.firstVisibleRow(scroll)?.dataset.transcriptVirtualBlockId).toBe("row-1");
});
