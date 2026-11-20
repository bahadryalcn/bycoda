// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TranscriptLayoutWatch as Watch } from "./transcriptLayoutWatch";

type Observer = { callback: ResizeObserverCallback; targets: Set<Element> };
let observers: Observer[];
let TranscriptLayoutWatch: typeof Watch;

beforeEach(async () => {
  observers = [];
  // The window-wide resize observer lives in a module; a fresh copy builds one per test.
  vi.resetModules();
  ({ TranscriptLayoutWatch } = await import("./transcriptLayoutWatch"));
  vi.useFakeTimers();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      entry: Observer;
      constructor(callback: ResizeObserverCallback) {
        this.entry = { callback, targets: new Set() };
        observers.push(this.entry);
      }
      observe(target: Element) {
        this.entry.targets.add(target);
      }
      unobserve(target: Element) {
        this.entry.targets.delete(target);
      }
      disconnect() {
        this.entry.targets.clear();
      }
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

/** A scroller holding `turns` turns, each with a sibling above its list element. */
function transcript(turns: number) {
  const scroll = document.createElement("div");
  scroll.className = "agent-transcript";
  const lists: HTMLElement[] = [];
  const headers: HTMLElement[] = [];
  const turnNodes: HTMLElement[] = [];
  for (let index = 0; index < turns; index++) {
    const turn = document.createElement("div");
    const header = document.createElement("div");
    const list = document.createElement("div");
    turn.append(header, list);
    scroll.append(turn);
    turnNodes.push(turn);
    headers.push(header);
    lists.push(list);
  }
  document.body.append(scroll);
  return { scroll, lists, headers, turns: turnNodes };
}

function resized(...targets: Element[]) {
  for (const { callback } of observers)
    callback(
      targets
        .filter((target) => observers.some((observer) => observer.targets.has(target)))
        .map((target) => ({ target }) as unknown as ResizeObserverEntry),
      {} as ResizeObserver,
    );
}

it("observes each node once however many lists sit under it, with one observer", () => {
  const { scroll, lists } = transcript(30);
  const watch = new TranscriptLayoutWatch();
  for (const list of lists) watch.watch(list, scroll, () => {});
  expect(observers).toHaveLength(1);
  const targets = [...observers[0].targets];
  // The scroller and the 30 turns are shared; each list adds only itself and its header.
  expect(targets).toHaveLength(1 + 30 + 30 * 2);
  expect(new Set(targets).size).toBe(targets.length);
});

it("tells a list once per batch of size changes and only the lists that watch the node", async () => {
  const { scroll, lists, headers } = transcript(3);
  const watch = new TranscriptLayoutWatch();
  const calls = lists.map(() => vi.fn());
  lists.forEach((list, index) => watch.watch(list, scroll, calls[index]));

  resized(headers[1], lists[1], scroll);
  await Promise.resolve();
  // The scroller is an ancestor of every list; the header and list belong to the second turn.
  expect(calls.map((call) => call.mock.calls.length)).toEqual([1, 1, 1]);

  resized(headers[1], lists[1]);
  await Promise.resolve();
  expect(calls.map((call) => call.mock.calls.length)).toEqual([1, 2, 1]);
});

it("coalesces class and style flips into one call in the next frame, for the lists under the node", async () => {
  const { scroll, lists, turns } = transcript(3);
  const watch = new TranscriptLayoutWatch();
  const calls = lists.map(() => vi.fn());
  lists.forEach((list, index) => watch.watch(list, scroll, calls[index]));

  turns[0].classList.add("a");
  turns[0].style.paddingLeft = "4px";
  turns[0].classList.add("b");
  await vi.advanceTimersByTimeAsync(0);
  expect(calls[0]).not.toHaveBeenCalled();
  vi.advanceTimersToNextFrame();
  expect(calls.map((call) => call.mock.calls.length)).toEqual([1, 0, 0]);

  scroll.classList.add("busy");
  await vi.advanceTimersByTimeAsync(0);
  vi.advanceTimersToNextFrame();
  expect(calls.map((call) => call.mock.calls.length)).toEqual([2, 1, 1]);
});

it("stops telling a released list and drops its nodes once nobody watches them", async () => {
  const { scroll, lists, headers, turns } = transcript(2);
  const watch = new TranscriptLayoutWatch();
  const first = vi.fn();
  const second = vi.fn();
  const release = watch.watch(lists[0], scroll, first);
  watch.watch(lists[1], scroll, second);

  release();
  expect(observers[0].targets.has(headers[0])).toBe(false);
  expect(observers[0].targets.has(lists[0])).toBe(false);
  // Shared nodes stay for the list that is still mounted.
  expect(observers[0].targets.has(scroll)).toBe(true);
  expect(observers[0].targets.has(turns[1])).toBe(true);

  resized(scroll);
  turns[0].classList.add("late");
  await vi.advanceTimersByTimeAsync(0);
  vi.advanceTimersToNextFrame();
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
});

it("does not call a list released while its re-measure was still pending", async () => {
  const { scroll, lists } = transcript(1);
  const watch = new TranscriptLayoutWatch();
  const listener = vi.fn();
  const release = watch.watch(lists[0], scroll, listener);
  resized(lists[0]);
  release();
  await Promise.resolve();
  vi.advanceTimersToNextFrame();
  expect(listener).not.toHaveBeenCalled();
});
