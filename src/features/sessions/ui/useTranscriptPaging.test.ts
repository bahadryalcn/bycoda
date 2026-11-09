// @vitest-environment happy-dom
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { MAX_TRANSCRIPT_WINDOW_TURNS, useTranscriptPaging } from "./useTranscriptPaging";

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
}: {
  turns: Block[][];
  load?: () => Promise<number | void>;
  more?: boolean;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const distance = useRef(0);
  const prepend = useRef<number | null>(null);
  api = useTranscriptPaging({
    turns,
    blockCount: turns.length,
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
      createElement("div", { key: turn[0].id, "data-transcript-turn": turn[0].id }, turn[0].text),
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
    const top = this.hasAttribute("data-transcript-turn")
      ? Array.from(parent!.children).indexOf(this) * 100 - parent!.scrollTop
      : 0;
    return new DOMRect(0, top, 500, this.hasAttribute("data-transcript-turn") ? 100 : 300);
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function render(turns: Block[][], load?: () => Promise<number | void>, more = false) {
  act(() => root.render(createElement(Harness, { turns, load, more })));
  scroller = host.firstElementChild as HTMLDivElement;
}

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
