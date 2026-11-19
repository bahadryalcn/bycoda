// @vitest-environment happy-dom
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import {
  MAX_TRANSCRIPT_WINDOW_TURNS,
  runRemoteLoad,
  useTranscriptPaging,
} from "./useTranscriptPaging";

let root: Root;
let host: HTMLDivElement;
let api: ReturnType<typeof useTranscriptPaging>;
let scroller: HTMLDivElement;
const history = (count: number, start = 0): Block[][] =>
  Array.from({ length: count }, (_, i) => [
    { id: `u-${start + i}`, role: "user", text: `Question ${start + i}` },
  ]);
function Harness({
  turns,
  load,
  more = false,
  follow = true,
}: {
  turns: Block[][];
  load?: () => Promise<number | void>;
  more?: boolean;
  follow?: boolean;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const stick = useRef(follow);
  const distance = useRef(0);
  const prepend = useRef<number | null>(null);
  api = useTranscriptPaging({
    turns,
    blockCount: turns.reduce((count, turn) => count + turn.length, 0),
    openWork: {},
    scroller: scroll,
    stickToBottom: stick,
    distanceFromBottom: distance,
    prependHeight: prepend,
    remoteHistoryHasMore: more,
    onLoadRemoteHistory: load,
  });
  return createElement(
    "div",
    { ref: scroll, "data-scroll": true },
    api.visibleTurns.map((turn) =>
      createElement(
        "div",
        { key: turn[0].id, "data-transcript-turn": turn[0].id },
        turn.map((block) =>
          createElement(
            "div",
            { key: block.id, "data-transcript-virtual-block-id": block.id },
            block.text,
          ),
        ),
      ),
    ),
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.children.length * 100;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const parent = this.parentElement;
    if (this.hasAttribute("data-transcript-virtual-block-id")) {
      const top =
        parent!.getBoundingClientRect().top + Array.from(parent!.children).indexOf(this) * 20;
      return new DOMRect(0, top, 500, 20);
    }
    const top = this.hasAttribute("data-transcript-turn")
      ? Array.from(parent!.children).indexOf(this) * 100 - parent!.scrollTop
      : 0;
    return new DOMRect(0, top, 500, this.hasAttribute("data-transcript-turn") ? 100 : 300);
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

it("keeps a message in place when earlier history changes the first turn key", async () => {
  let finish!: (added: number) => void;
  const load = () =>
    new Promise<number>((resolve) => {
      finish = resolve;
    });
  const current = history(10, 20);
  render(current, load, true, false);
  scroller.scrollTop = 0;
  const rowTop = () =>
    scroller.querySelector('[data-transcript-virtual-block-id="u-20"]')!.getBoundingClientRect()
      .top;
  const before = rowTop();
  act(() => api.onHistoryScroll(0, true));
  await act(async () => {
    const expanded = [[history(1, 19)[0][0], ...current[0]], ...current.slice(1)];
    root.render(createElement(Harness, { turns: expanded, more: false, follow: false }));
    finish(1);
  });
  expect(rowTop()).toBe(before);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function render(
  turns: Block[][],
  load?: () => Promise<number | void>,
  more = false,
  follow = true,
) {
  act(() => root.render(createElement(Harness, { turns, load, more, follow })));
  scroller = host.firstElementChild as HTMLDivElement;
}

it("loads one earlier page on upward reader input and keeps the reading position", async () => {
  let finish!: (added: number) => void;
  const load = vi.fn(
    () =>
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
  );
  render(history(10, 20), load, true, false);
  scroller.scrollTop = 120;
  act(() => api.onHistoryScroll(400, false, false));
  act(() => api.onHistoryScroll(120, false, false));
  expect(load).not.toHaveBeenCalled();
  act(() => api.onHistoryScroll(120, true));
  act(() => api.onHistoryScroll(120, true));
  expect(load).toHaveBeenCalledOnce();
  const visible = () => scroller.querySelector<HTMLElement>('[data-transcript-turn="u-21"]');
  const offset = visible()!.getBoundingClientRect().top;
  await act(async () => {
    root.render(createElement(Harness, { turns: history(30), load, more: false, follow: false }));
    finish(20);
  });
  expect(visible()!.getBoundingClientRect().top).toBe(offset);
});

it("bounds repeated earlier/newer paging and preserves an overlapping turn's viewport offset", async () => {
  render(history(1000));
  for (let page = 0; page < 49; page++) {
    scroller.scrollTop = 0;
    const id = api.visibleTurns[0][0].id;
    await act(() => api.loadEarlier());
    expect(api.visibleTurns.length).toBeLessThanOrEqual(MAX_TRANSCRIPT_WINDOW_TURNS);
    const anchor = scroller.querySelector<HTMLElement>(`[data-transcript-turn="${id}"]`);
    if (anchor) expect(anchor.getBoundingClientRect().top).toBe(0);
  }
  expect(api.firstVisibleTurn).toBe(0);
  for (let page = 0; page < 50; page++) act(() => api.loadNewer());
  expect(api.lastVisibleTurn).toBe(1000);
  expect(api.visibleTurns.length).toBeLessThanOrEqual(MAX_TRANSCRIPT_WINDOW_TURNS);
});

it("recenters any reveal without mounting intervening saved turns and returns to live tail", () => {
  render(history(10_000));
  act(() => {
    expect(api.revealBlock("u-0")).toBe(true);
  });
  expect(api.firstVisibleTurn).toBe(0);
  expect(scroller.querySelector('[data-transcript-turn="u-0"]')).not.toBeNull();
  expect(scroller.children.length).toBe(MAX_TRANSCRIPT_WINDOW_TURNS);
  act(() => {
    expect(api.revealBlock("u-5000")).toBe(true);
  });
  expect(scroller.querySelector('[data-transcript-turn="u-5000"]')).not.toBeNull();
  expect(api.findTurn("u-9999")?.[0].text).toBe("Question 9999");
  act(() => api.jumpLatest());
  expect(api.lastVisibleTurn).toBe(10_000);
  expect(scroller.children.length).toBe(20);
});

it("retains exact historical IDs when saved history prepends or live output appends", () => {
  render(history(100));
  act(() => api.revealBlock("u-20"));
  const first = api.visibleTurns[0][0].id;
  render([...history(20, -20), ...history(101)]);
  expect(api.visibleTurns[0][0].id).toBe(first);
  expect(api.visibleTurns.length).toBe(MAX_TRANSCRIPT_WINDOW_TURNS);
  expect(api.findTurn("u-100")).toBeDefined();
});

it("keeps the window in place when its first turn disappears", () => {
  render(history(1000));
  act(() => api.revealBlock("u-500"));
  const first = api.firstVisibleTurn;
  const removed = api.visibleTurns[0][0].id;
  render(history(1000).filter((turn) => turn[0].id !== removed));
  expect(api.firstVisibleTurn).toBe(first);
  expect(api.findTurn(removed)).toBeUndefined();
  expect(scroller.querySelector('[data-transcript-turn="u-500"]')).not.toBeNull();
  // Turns removed from the end, the first one included, leave the last page in view.
  render(history(first));
  expect(api.lastVisibleTurn).toBe(first);
  expect(api.visibleTurns.length).toBe(MAX_TRANSCRIPT_WINDOW_TURNS);
});

it("keeps remote load errors visible and allows the same earlier page to retry", async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(0);
  render(history(10), load, true);
  await act(() => api.loadEarlier());
  expect(api.pagingError).toBe("offline");
  expect(api.pagingLoading).toBe(false);
  await act(() => api.loadEarlier());
  expect(load).toHaveBeenCalledTimes(2);
  expect(api.pagingError).toBeNull();
});

it("does not let a delayed remote earlier page replace a newer search window", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  render(history(100), () => pending, true);
  act(() => api.revealBlock("u-0"));
  let loading!: Promise<void>;
  act(() => {
    loading = api.loadEarlier();
  });
  act(() => api.revealBlock("u-90"));
  const first = api.firstVisibleTurn;
  await act(async () => {
    release();
    await loading;
  });
  expect(api.firstVisibleTurn).toBe(first);
  expect(scroller.querySelector('[data-transcript-turn="u-90"]')).not.toBeNull();
});

it("leaves the scroll position alone when a turn is appended while the reader is scrolled up", () => {
  render(history(5), undefined, false, false);
  scroller.scrollTop = 50;
  render(history(6), undefined, false, false);
  expect(scroller.scrollTop).toBe(50);
});

it.each([
  ["a dropped link", new Error("RPC_WS_INTERRUPTED: Host connection was interrupted"), null],
  ["a real failure", new Error("Session history is unreadable"), "Session history is unreadable"],
])("reports %s to the paging error only when it is not transient", async (_name, error, shown) => {
  const setPagingError = vi.fn();
  const loadingRef = { current: true };
  await runRemoteLoad({
    load: () => Promise.reject(error),
    stale: () => false,
    apply: () => {},
    loadingRef,
    setPagingLoading: () => {},
    setPagingError,
  });
  expect(setPagingError).toHaveBeenCalledWith(shown);
  expect(loadingRef.current).toBe(false);
});

it.each([
  ["adds nothing (it failed and said so itself)", 0, false],
  ["adds blocks", 20, true],
  ["reports no count", undefined, true],
])("moves the window only when the remote load %s", async (_name, added, moved) => {
  const apply = vi.fn();
  await runRemoteLoad({
    load: () => Promise.resolve(added),
    stale: () => false,
    apply,
    loadingRef: { current: true },
    setPagingLoading: () => {},
    setPagingError: () => {},
  });
  expect(apply).toHaveBeenCalledTimes(moved ? 1 : 0);
});
