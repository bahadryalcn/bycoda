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

type Spec = { id: string; top: number; height: number; parent?: string; owner?: "other" };

/** Rows laid out by explicit geometry (document order = spec order), counting row rect reads. */
function layout(specs: Spec[], options: { agent?: boolean; scrollTop: number }) {
  const owner = new TranscriptVirtualization();
  const scroll = document.createElement("div");
  if (options.agent) scroll.className = "agent-transcript";
  const other = document.createElement("div");
  Object.defineProperty(scroll, "clientHeight", { value: VIEWPORT });
  const rect = (top: number, height: number) =>
    ({ top: top - options.scrollTop, bottom: top + height - options.scrollTop, height }) as DOMRect;
  scroll.getBoundingClientRect = () => rect(options.scrollTop, VIEWPORT);
  const nodes = new Map<string, HTMLElement>();
  let reads = 0;
  for (const spec of specs) {
    const node = document.createElement("div");
    node.dataset.transcriptVirtualBlockId = spec.id;
    node.getBoundingClientRect = () => {
      reads++;
      return rect(spec.top, spec.height);
    };
    owner.rowScroll.set(node, spec.owner ? other : scroll);
    (spec.parent ? nodes.get(spec.parent)! : scroll).append(node);
    nodes.set(spec.id, node);
  }
  document.body.append(scroll);
  return { owner, scroll, reads: () => reads };
}

const flat = (count: number, height: number): Spec[] =>
  Array.from({ length: count }, (_, i) => ({ id: `r${i}`, top: i * height, height }));
const idOf = (node: HTMLElement | null) => node?.dataset.transcriptVirtualBlockId ?? null;

it("picks the same anchor for rows above, inside and below the viewport", () => {
  const rows = flat(10, 60); // row i spans [60i, 60i+60)
  const { owner, scroll } = layout(rows, { scrollTop: 130 }); // viewport [130, 230)
  expect(idOf(owner.firstVisibleRow(scroll))).toBe("r2");
  const none = layout(rows, { scrollTop: 100000 });
  expect(none.owner.firstVisibleRow(none.scroll)).toBeNull();
  const empty = layout([], { scrollTop: 0 });
  expect(empty.owner.firstVisibleRow(empty.scroll)).toBeNull();
});

it("anchors on the first visible nested row when a virtual row contains others", () => {
  const specs: Spec[] = [
    { id: "a", top: 0, height: 100 },
    { id: "b", top: 100, height: 400 },
    { id: "b1", top: 100, height: 100, parent: "b" },
    { id: "b2", top: 200, height: 300, parent: "b" },
    { id: "c", top: 500, height: 100 },
  ];
  const { owner, scroll } = layout(specs, { scrollTop: 120 });
  expect(idOf(owner.firstVisibleRow(scroll))).toBe("b1");
});

it("ignores rows owned by a nested scroll container", () => {
  const specs: Spec[] = [
    { id: "a", top: 0, height: 200 },
    { id: "x", top: 0, height: 200, owner: "other" },
    { id: "b", top: 200, height: 200 },
  ];
  const { owner, scroll } = layout(specs, { scrollTop: 10 });
  expect(idOf(owner.firstVisibleRow(scroll))).toBe("a");
});

it("uses the turn binary search on agent-transcript scrollers", () => {
  const { owner, scroll } = transcript(10, 4 * ROWS_PER_TURN * ROW + ROW + 5);
  expect(idOf(owner.firstVisibleRow(scroll))).toBe(`row-${4 * ROWS_PER_TURN + 1}`);
  const empty = layout([], { agent: true, scrollTop: 0 });
  expect(empty.owner.firstVisibleRow(empty.scroll)).toBeNull();
});

it("stops measuring once a candidate is followed by a row outside it", () => {
  // Each row is taller than the viewport, so the anchor is the only visible row and
  // every later row sits below the viewport: none of them may be measured.
  const rows = flat(200, 500);
  const { owner, scroll, reads } = layout(rows, { scrollTop: 500 * 50 + 100 });
  expect(idOf(owner.firstVisibleRow(scroll))).toBe("r50");
  // 50 rows above (a plain scroller has no turn index), the anchor, at most one row after it.
  expect(reads()).toBeLessThanOrEqual(52);
});

it("keeps the container as anchor when its children are above and below the viewport", () => {
  const specs: Spec[] = [
    { id: "p", top: 0, height: 500 },
    { id: "p1", top: 0, height: 50, parent: "p" },
    { id: "p2", top: 300, height: 50, parent: "p" },
    { id: "q", top: 500, height: 100 },
  ];
  const { owner, scroll } = layout(specs, { scrollTop: 100 });
  expect(idOf(owner.firstVisibleRow(scroll))).toBe("p");
});
