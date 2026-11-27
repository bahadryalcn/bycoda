// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
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
  else scroll.style.overflowY = "auto";
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

it("does not undo a scroll that the browser has not delivered an event for yet", () => {
  const position = { scrollTop: 130 };
  const { owner, scroll } = layout(flat(10, 60), position);
  Object.defineProperty(scroll, "scrollTop", {
    get: () => position.scrollTop,
    set: (value: number) => {
      position.scrollTop = value;
    },
  });
  vi.useFakeTimers();
  const anchor = owner.acquire(scroll, null);
  try {
    anchor.changed();
    position.scrollTop = 128;
    vi.advanceTimersToNextFrame();
    expect(scroll.scrollTop).toBe(128);
  } finally {
    anchor.release();
    scroll.remove();
    vi.useRealTimers();
  }
});

it("applies a layout shift once even when the browser rounds the scroll offset", () => {
  const position = { scrollTop: 130 };
  const rows = flat(10, 60);
  const { owner, scroll } = layout(rows, position);
  Object.defineProperty(scroll, "scrollTop", {
    get: () => position.scrollTop,
    set: (value: number) => {
      position.scrollTop = Math.floor(value);
    },
  });
  const adjusted = vi.fn();
  owner.setAdjusted(adjusted);
  vi.useFakeTimers();
  const anchor = owner.acquire(scroll, null);
  try {
    rows[2].top += 1.75;
    anchor.changed();
    vi.advanceTimersToNextFrame();
    expect(scroll.scrollTop).toBe(131);
    expect(adjusted).toHaveBeenCalledOnce();

    anchor.changed();
    vi.advanceTimersToNextFrame();
    expect(scroll.scrollTop).toBe(131);
    expect(adjusted).toHaveBeenCalledOnce();
  } finally {
    anchor.release();
    scroll.remove();
    vi.useRealTimers();
  }
});

it("leaves the scroller to bottom-follow and resumes anchoring after the reader leaves", () => {
  const position = { scrollTop: 130 };
  const rows = flat(10, 60);
  const { owner, scroll } = layout(rows, position);
  Object.defineProperty(scroll, "scrollTop", {
    get: () => position.scrollTop,
    set: (value: number) => {
      position.scrollTop = value;
    },
  });
  let following = true;
  const adjusted = vi.fn();
  owner.setAdjusted(adjusted, () => !following);
  vi.useFakeTimers();
  const anchor = owner.acquire(scroll, null);
  try {
    rows[2].top -= 1;
    anchor.changed();
    vi.advanceTimersToNextFrame();
    expect(scroll.scrollTop).toBe(130);
    expect(adjusted).not.toHaveBeenCalled();

    following = false;
    rows[2].top += 5;
    anchor.changed();
    vi.advanceTimersToNextFrame();
    expect(scroll.scrollTop).toBe(135);
    expect(adjusted).toHaveBeenCalledWith(scroll);
  } finally {
    anchor.release();
    scroll.remove();
    vi.useRealTimers();
  }
});

it("does not move the transcript when a phase gains its own scroller", () => {
  const position = { scrollTop: 130, agent: true };
  const rows = flat(10, 60);
  const { owner, scroll } = layout(rows, position);
  Object.defineProperty(scroll, "scrollTop", {
    get: () => position.scrollTop,
    set: (value: number) => {
      position.scrollTop = value;
    },
  });
  const row = scroll.querySelector('[data-transcript-virtual-block-id="r2"]')!;
  const phase = document.createElement("div");
  row.before(phase);
  phase.append(row);
  const adjusted = vi.fn();
  owner.setAdjusted(adjusted);
  vi.useFakeTimers();
  const anchor = owner.acquire(scroll, null);
  try {
    // The list remains mounted with its old owner as the live phase starts scrolling.
    phase.style.overflowY = "auto";
    for (let frame = 0; frame < 3; frame++) {
      rows[2].top -= 4;
      anchor.changed();
      vi.advanceTimersToNextFrame();
    }
    expect(scroll.scrollTop).toBe(130);
    expect(adjusted).not.toHaveBeenCalled();
  } finally {
    anchor.release();
    scroll.remove();
    vi.useRealTimers();
  }
});

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

it("settles only the reveal it was given, so a newer target survives", () => {
  const owner = new TranscriptVirtualization("restored");
  let notified = 0;
  owner.subscribe(() => notified++);
  owner.settleReveal("other");
  expect(owner.snapshot()).toBe("restored");
  owner.settleReveal("restored");
  expect(owner.snapshot()).toBeNull();
  expect(notified).toBe(1);
  owner.reveal("next");
  owner.settleReveal("restored");
  expect(owner.snapshot()).toBe("next");
});

it("drops fold state of rows a list no longer has, and leaves other lists alone", () => {
  const owner = new TranscriptVirtualization();
  const folds = owner.codeFoldsFor("turn:1:items");
  folds.set("kept", { a: true });
  folds.set("removed", { b: false });
  owner.codeFoldsFor("turn:2:items").set("removed", { c: true });

  owner.retainRows("turn:1:items", new Set(["kept"]));

  expect([...folds.keys()]).toEqual(["kept"]);
  expect(owner.codeFoldsFor("turn:2:items").get("removed")).toEqual({ c: true });
});

it("drops a list's sizes and folds when it unmounts, and restores them on a replayed mount", () => {
  const owner = new TranscriptVirtualization();
  const sizes = new Map([["row", { width: 1, height: 2 }]]);
  const folds = new Map([["row", { a: true }]]);

  const release = owner.holdList("list", sizes, folds);
  expect(owner.measurementsFor("list")).toBe(sizes);
  release();
  expect(owner.measurements.has("list")).toBe(false);
  expect(owner.codeFolds.has("list")).toBe(false);

  // A strict-mode replay holds the same maps again, so the owner sees them as before.
  const replay = owner.holdList("list", sizes, folds);
  expect(owner.codeFoldsFor("list")).toBe(folds);
  replay();
});

it("lets a newer hold of a list survive the release of an older one", () => {
  const owner = new TranscriptVirtualization();
  const older = owner.holdList("list", new Map(), new Map());
  const newerFolds = new Map<string, Record<string, boolean>>();
  const newer = owner.holdList("list", new Map(), newerFolds);

  older();
  expect(owner.codeFolds.get("list")).toBe(newerFolds);
  newer();
  expect(owner.codeFolds.has("list")).toBe(false);
});
