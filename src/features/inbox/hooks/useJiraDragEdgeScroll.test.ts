// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDragEdgeScroll } from "./useJiraDragEdgeScroll";

let frames: Map<number, FrameRequestCallback>;
let host: HTMLElement;
let column: HTMLElement;
let zone: HTMLElement;
let scrollTop: number;

/** Runs the queued frames until none are pending; returns how many ran. */
function flush(limit = 200) {
  let ran = 0;
  while (frames.size > 0 && ran < limit) {
    const [id, callback] = frames.entries().next().value!;
    frames.delete(id);
    callback(0);
    ran++;
  }
  return ran;
}

function place(element: HTMLElement, top: number, bottom: number, left: number, right: number) {
  element.getBoundingClientRect = () =>
    ({
      top,
      bottom,
      left,
      right,
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    }) as DOMRect;
}

beforeEach(() => {
  frames = new Map();
  let next = 1;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = next++;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  host = document.createElement("div");
  host.innerHTML =
    '<div class="jira-board-columns"><section class="jira-board-column"><article data-jira-drop="zone"></article></section></div>';
  document.body.append(host);
  column = host.querySelector<HTMLElement>(".jira-board-column")!;
  zone = host.querySelector<HTMLElement>("[data-jira-drop]")!;
  place(column, 0, 100, 0, 200);
  place(host.querySelector<HTMLElement>(".jira-board-columns")!, 0, 100, 0, 400);
  // A column that can scroll 300px in total; the browser clamps the assignment the same way.
  scrollTop = 0;
  Object.defineProperty(column, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = Math.min(300, Math.max(0, value));
    },
  });
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => zone,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "elementFromPoint");
  host.remove();
});

it("keeps scrolling a held bottom edge on frames without pointer events, reporting the zone each frame, and ends at the scroll limit", () => {
  const scroll = createDragEdgeScroll();
  const reported: (HTMLElement | null)[] = [];
  scroll.track({ clientX: 50, clientY: 95 }, zone, (hit) => reported.push(hit));

  const ran = flush();

  expect(scrollTop).toBe(300);
  expect(ran).toBeLessThan(60);
  expect(reported).toHaveLength(ran);
  expect(reported.every((hit) => hit === zone)).toBe(true);
  expect(frames.size).toBe(0);
});

it("reports the zone once and starts no scroll when the pointer is away from the edges", () => {
  const scroll = createDragEdgeScroll();
  const follow = vi.fn();
  scroll.track({ clientX: 50, clientY: 50 }, zone, follow);

  expect(flush()).toBe(1);
  expect(scrollTop).toBe(0);
  expect(follow).toHaveBeenCalledTimes(1);
  expect(follow).toHaveBeenCalledWith(zone, { clientX: 50, clientY: 50 });
});

it("stop cancels the pending frame so no scroll or target report runs after a drop or cancel", () => {
  const scroll = createDragEdgeScroll();
  const follow = vi.fn();
  scroll.track({ clientX: 50, clientY: 5 }, zone, follow);
  scroll.stop();

  expect(flush()).toBe(0);
  expect(scrollTop).toBe(0);
  expect(follow).not.toHaveBeenCalled();
});
