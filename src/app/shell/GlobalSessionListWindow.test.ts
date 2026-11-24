// @vitest-environment happy-dom
import { act, createElement, useRef, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import { GlobalSessionListWindow } from "./GlobalSessionListWindow";

const makeSessions = (): SessionSummary[] =>
  Array.from({ length: 1000 }, (_, index) => ({
    id: `session-${index % 500}`,
    cwd: index < 500 ? "/workspace/one" : "/workspace/two",
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
    title: `Conversation ${index}`,
    createdAt: 1,
    updatedAt: 1000 - index,
  }));

function Window({ sessions }: { sessions: SessionSummary[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  return createElement(
    "div",
    {
      ref: scrollRef,
      "data-scroll-owner": "",
      className: "overflow-y-auto",
    },
    createElement(GlobalSessionListWindow, {
      sessions,
      scrollRef: scrollRef as RefObject<HTMLDivElement | null>,
      view: { groupBy: "none", sort: "newest" },
      stateOf: () => "idle" as const,
      isActive: (session) => session.cwd === "/workspace/two" && session.id === "session-250",
      renderSession: (session, active) =>
        createElement(
          "div",
          {
            "data-session-cwd": session.cwd,
            "data-session-id": session.id,
            "data-session-index": session.title.replace("Conversation ", ""),
            "data-global-active": active ? "true" : undefined,
            tabIndex: 0,
          },
          session.title,
        ),
    }),
  );
}

let container: HTMLDivElement;
let root: Root;
let sessions: SessionSummary[];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sessions = makeSessions();
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute("data-index") ? 64 : 480;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(320);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(640);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps global history bounded and scrollable while retaining exact active row", async () => {
  await act(async () => root.render(createElement(Window, { sessions })));
  const viewport = container.querySelector<HTMLElement>("[data-scroll-owner]")!;
  const list = container.querySelector<HTMLElement>("[data-session-list]")!;
  Object.defineProperty(viewport, "scrollHeight", { configurable: true, value: 100_000 });
  viewport.getBoundingClientRect = () => new DOMRect(0, 0, 640, 320);
  list.getBoundingClientRect = () => new DOMRect(0, 0, 640, 64_000);

  const activeRows = () => container.querySelectorAll('[data-global-active="true"]');
  expect(activeRows()).toHaveLength(1);
  expect(activeRows()[0].getAttribute("data-session-cwd")).toBe("/workspace/two");
  expect(activeRows()[0].getAttribute("data-session-index")).toBe("750");
  expect(container.querySelectorAll("[data-index]").length).toBeLessThan(100);
  expect(list.parentElement).toBe(viewport);

  viewport.scrollTop = 25_000;
  await act(async () => viewport.dispatchEvent(new Event("scroll")));
  const indices = Array.from(container.querySelectorAll<HTMLElement>("[data-index]"), (row) =>
    Number(row.dataset.index),
  );
  expect(indices.some((index) => index > 300 && index < 500)).toBe(true);
  expect(indices).toContain(750);
  expect(activeRows()).toHaveLength(1);
  expect(container.querySelectorAll("[data-index]").length).toBeLessThan(100);
  expect(viewport.scrollTop).toBe(25_000);
});

it("keeps browser scroll anchoring off the windowed session scroller", () => {
  // The virtualizer already corrects the offset; a second browser correction jumps the list.
  const css = readFileSync("src/app/shell/sessionList.css", "utf8");
  expect(css).toMatch(/\.sidebar-session-scroll\s*\{[^}]*overflow-anchor:\s*none/);
});

it("windows a medium-sized list while keeping its focused row mounted after scrolling", async () => {
  await act(async () => root.render(createElement(Window, { sessions: sessions.slice(0, 48) })));
  const viewport = container.querySelector<HTMLElement>("[data-scroll-owner]")!;
  const focused = container.querySelector<HTMLElement>('[data-session-index="0"]')!;
  expect(container.querySelectorAll("[data-session-index]").length).toBeLessThan(28);
  act(() => focused.focus());
  viewport.scrollTop = 2100;
  await act(async () => viewport.dispatchEvent(new Event("scroll")));
  expect(document.activeElement).toBe(focused);
  expect(container.querySelector('[data-session-index="34"]')).not.toBeNull();
});

it("keeps short lists in normal flow", async () => {
  await act(async () => root.render(createElement(Window, { sessions: sessions.slice(0, 12) })));
  expect(container.querySelectorAll("[data-session-index]")).toHaveLength(12);
  expect(container.querySelectorAll("[data-index]")).toHaveLength(0);
});

it("keeps a fixed list offset across filters and follows preceding content when it moves", async () => {
  const resized = new Map<Element, () => void>();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private deliver: (entries: Partial<ResizeObserverEntry>[]) => void) {}
      observe(target: Element, options?: ResizeObserverOptions) {
        // The virtualizer separately observes rows and the scroll viewport with explicit boxes.
        if (options) return;
        resized.set(target, () =>
          this.deliver([{ target, contentRect: new DOMRect(0, 0, 300, 20) }]),
        );
      }
      unobserve(target: Element) {
        resized.delete(target);
      }
      disconnect() {}
    },
  );
  const render = async (count: number) =>
    act(async () => root.render(createElement(Window, { sessions: sessions.slice(0, count) })));
  await render(400);
  const viewport = container.querySelector<HTMLElement>("[data-scroll-owner]")!;
  const list = container.querySelector<HTMLElement>("[data-session-list]")!;
  const offsets: number[] = [];
  const banner = document.createElement("div");
  let height = 48;
  vi.spyOn(list, "getBoundingClientRect").mockImplementation(() => {
    const top = banner.isConnected ? height : 0;
    offsets.push(top);
    return new DOMRect(0, top, 300, 5000);
  });
  await act(async () => resized.get(viewport)!());
  expect(offsets).toEqual([0]);
  offsets.length = 0;
  await render(160);
  await render(72);
  expect(offsets).toEqual([]);
  // Changing rows changes the UL's height without moving its top.
  await act(async () => resized.get(list)?.());
  await act(async () => resized.get(viewport)!());
  expect(offsets).toEqual([]);
  await act(async () => {
    viewport.insertBefore(banner, list);
  });
  await vi.waitFor(() => expect(offsets).toContain(48));
  height = 24;
  await act(async () => resized.get(banner)!());
  await vi.waitFor(() => expect(offsets).toContain(24));
  await act(async () => banner.remove());
  await vi.waitFor(() => expect(offsets[offsets.length - 1]).toBe(0));
  const previousOffsets = offsets.length;
  await act(async () => root.render(null));
  await render(120);
  const replacement = container.querySelector<HTMLElement>("[data-session-list]")!;
  expect(replacement).not.toBe(list);
  const replacementRead = vi.spyOn(replacement, "getBoundingClientRect");
  await act(async () => resized.get(replacement.parentElement!)!());
  expect(replacementRead).toHaveBeenCalledTimes(1);
  expect(offsets).toHaveLength(previousOffsets);
});

it("takes row heights from the observer batch and reuses them when a filter remounts a row", async () => {
  const observed = new Map<Element, (entry: ResizeObserverEntry) => void>();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private deliver: (entries: ResizeObserverEntry[]) => void) {}
      observe(element: Element) {
        if (element.hasAttribute("data-index"))
          observed.set(element, (entry) => this.deliver([entry]));
      }
      unobserve(element: Element) {
        observed.delete(element);
      }
      disconnect() {}
    },
  );
  const rowReads = vi.fn();
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (!this.hasAttribute("data-index")) return 480;
    rowReads();
    return 64;
  });
  const render = async (items: SessionSummary[]) =>
    act(async () => root.render(createElement(Window, { sessions: items })));
  const row = (index: number) => container.querySelector<HTMLElement>(`li[data-index="${index}"]`)!;
  await render(sessions);
  expect(rowReads).toHaveBeenCalledTimes(0);
  const first = row(0);
  const resize = async (element: HTMLElement, height: number) =>
    act(async () =>
      observed.get(element)!({
        target: element,
        borderBoxSize: [{ blockSize: height, inlineSize: 300 }],
      } as unknown as ResizeObserverEntry),
    );
  await resize(first, 83.8);
  expect(row(1).style.transform).toBe("translateY(92px)");
  await render(sessions.slice(1));
  await render(sessions);
  expect(row(0)).not.toBe(first);
  expect(row(1).style.transform).toBe("translateY(92px)");
  await resize(row(0), 44);
  expect(row(1).style.transform).toBe("translateY(52px)");
  expect(rowReads).toHaveBeenCalledTimes(0);
  // Older observers only provide a content box; the library reads the actual border box then.
  await act(async () =>
    observed.get(row(0))!({
      target: row(0),
      contentRect: new DOMRect(0, 0, 300, 64),
      contentBoxSize: [{ blockSize: 64, inlineSize: 300 }],
      borderBoxSize: [],
      devicePixelContentBoxSize: [],
    }),
  );
  expect(row(1).style.transform).toBe("translateY(72px)");
  expect(rowReads).toHaveBeenCalledTimes(1);
});

it("measures the actual row on mount when ResizeObserver is unavailable", async () => {
  vi.stubGlobal("ResizeObserver", undefined);
  await act(async () => root.render(createElement(Window, { sessions })));
  expect(container.querySelector<HTMLElement>('li[data-index="1"]')?.style.transform).toBe(
    "translateY(72px)",
  );
});

it("bounds the first paint around the restored scroll position before viewport measurement", async () => {
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(0);
  await act(async () => root.render(createElement(Window, { sessions })));
  const viewport = container.querySelector<HTMLElement>("[data-scroll-owner]")!;
  Object.defineProperty(viewport, "scrollHeight", { configurable: true, value: 58_046 });
  viewport.scrollTop = 58 * 250 + 6;
  await act(async () => root.render(createElement(Window, { sessions: [...sessions] })));
  const indexes = [...container.querySelectorAll<HTMLElement>("[data-index]")].map((row) =>
    Number(row.dataset.index),
  );
  expect(indexes).toContain(250);
  expect(indexes).toContain(750);
  expect(indexes.length).toBeLessThanOrEqual(17);
});
