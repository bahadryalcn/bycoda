// @vitest-environment happy-dom
import { PooledTranscript, TranscriptPool, TranscriptPoolOutlet } from "./TranscriptPool";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { beginResizeGesture } from "../../../shared/lib/resizeGesture";
import { TranscriptVirtualRows, type TranscriptVirtualRow } from "./TranscriptVirtualRows";
import {
  TranscriptVirtualization,
  TranscriptVirtualizationContext,
} from "./transcriptVirtualization";
import { useRetainedDisclosure } from "./useRetainedDisclosure";
import { AgentTranscript } from "./AgentTranscript";
import type { Block } from "../model/session";

// Counts `measure()` (which drops every measured row size) without changing it.
const measureCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock("@tanstack/react-virtual", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-virtual")>();
  const wrapped = new WeakSet<object>();
  return {
    ...actual,
    useVirtualizer: ((options: Parameters<typeof actual.useVirtualizer>[0]) => {
      const virtualizer = actual.useVirtualizer(options);
      if (!wrapped.has(virtualizer)) {
        wrapped.add(virtualizer);
        const measure = virtualizer.measure.bind(virtualizer);
        virtualizer.measure = () => {
          measureCalls.count++;
          measure();
        };
      }
      return virtualizer;
    }) as typeof actual.useVirtualizer,
  };
});

let host: HTMLDivElement;
let root: Root;
let owner: TranscriptVirtualization;
const sizes = new Map<string, number>();
function height(element: HTMLElement): number {
  if (element.dataset.index !== undefined)
    return sizes.get(element.dataset.transcriptVirtualBlockId ?? "") ?? 40;
  if (element.classList.contains("agent-transcript")) return 400;
  if (element.style.height) return Number.parseFloat(element.style.height) || 0;
  return [...element.children].reduce((sum, child) => sum + height(child as HTMLElement), 0);
}
function top(element: HTMLElement): number {
  const parent = element.parentElement;
  if (!parent || element.classList.contains("agent-transcript")) return 0;
  let result = top(parent) - (parent.classList.contains("agent-transcript") ? parent.scrollTop : 0);
  for (const sibling of parent.children) {
    if (sibling === element) break;
    result += height(sibling as HTMLElement);
  }
  return result;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains("agent-transcript") ? 400 : height(this);
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(500);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return [...this.children].reduce((sum, child) => sum + height(child as HTMLElement), 0);
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return new DOMRect(0, top(this), 500, height(this));
  });
  vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(function (
    this: HTMLElement,
    options?: ScrollToOptions | number,
  ) {
    if (typeof options === "object") this.scrollTop = options.top ?? 0;
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  owner = new TranscriptVirtualization();
  sizes.clear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function mount(rows: TranscriptVirtualRow[]) {
  act(() =>
    root.render(
      createElement(
        TranscriptVirtualizationContext.Provider,
        { value: owner },
        createElement(
          "div",
          { className: "agent-transcript" },
          createElement(TranscriptVirtualRows, { rows, listId: "test" }),
        ),
      ),
    ),
  );
  return host.querySelector<HTMLElement>(".agent-transcript")!;
}
const rows = (count: number): TranscriptVirtualRow[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `row-${index}`,
    blockIds: [`block-${index}`],
    render: () => createElement("button", { type: "button" }, `Row ${index}`),
  }));
function scroll(element: HTMLElement, offset: number) {
  act(() => {
    element.scrollTop = offset;
    element.dispatchEvent(new Event("scroll"));
  });
}
const mounted = () => host.querySelectorAll("[data-transcript-virtual-owner]").length;

it("mounts viewport rows from ten thousand records and synchronously reveals an exact distant block", () => {
  const element = mount(rows(10_000));
  expect(mounted()).toBeLessThan(50);
  scroll(element, 250_000);
  expect(mounted()).toBeLessThan(50);
  act(() => owner.reveal("block-5000"));
  expect(host.querySelector('[data-transcript-virtual-block-id="block-5000"]')).not.toBeNull();
  expect(mounted()).toBeLessThan(55);
});

it("pins exact focused and selected rows across scrolling, then releases cleared selection", () => {
  const element = mount(rows(1000));
  const first = host.querySelector<HTMLElement>('[data-transcript-virtual-block-id="block-0"]')!;
  act(() => first.querySelector<HTMLButtonElement>("button")!.focus());
  scroll(element, 50_000);
  expect(first.isConnected).toBe(true);
  act(() => first.querySelector<HTMLButtonElement>("button")!.blur());
  scroll(element, 0);
  const selected = host.querySelector<HTMLElement>('[data-transcript-virtual-block-id="block-0"]')!;
  const range = document.createRange();
  range.selectNodeContents(selected);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  act(() => document.dispatchEvent(new Event("selectionchange")));
  scroll(element, 50_000);
  expect(selected.isConnected).toBe(true);
  expect(selection.toString()).toBe("Row 0");
  act(() => {
    selection.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
  });
  expect(mounted()).toBeLessThan(50);
});

it("preserves disclosure state across virtual unmount and return without a transcript pool", () => {
  function Cell() {
    const [open, setOpen] = useRetainedDisclosure("test:cell", false);
    const [collapsed, setCollapsed] = useState(false);
    return createElement(
      "div",
      null,
      createElement(
        "button",
        { onClick: () => setOpen(!open) },
        open ? "Open detail" : "Closed detail",
      ),
      createElement(
        "div",
        { className: "markdown-code-shell", "data-collapsed": String(collapsed) },
        createElement(
          "button",
          { className: "markdown-code-toggle", onClick: () => setCollapsed(!collapsed) },
          "Code fold",
        ),
      ),
    );
  }
  const records = rows(1000);
  records[0].render = () => createElement(Cell);
  const element = mount(records);
  const first = host.querySelector<HTMLElement>('[data-transcript-virtual-block-id="block-0"]')!;
  act(() => {
    first.querySelector<HTMLButtonElement>("button")!.click();
    first.querySelector<HTMLButtonElement>(".markdown-code-toggle")!.click();
  });
  scroll(element, 50_000);
  expect(first.isConnected).toBe(false);
  act(() => owner.reveal("block-0"));
  const restored = host.querySelector<HTMLElement>('[data-transcript-virtual-block-id="block-0"]')!;
  expect(restored.textContent).toContain("Open detail");
  expect(restored.querySelector<HTMLElement>(".markdown-code-shell")!.dataset.collapsed).toBe(
    "true",
  );
});

it("shares one measured-anchor correction and leaves outer turn ownership with the correct scroller", () => {
  vi.useFakeTimers();
  const scroller = document.createElement("div");
  scroller.className = "agent-transcript";
  const turn = document.createElement("div");
  const row = document.createElement("div");
  row.dataset.transcriptVirtualBlockId = "exact";
  turn.append(row);
  scroller.append(turn);
  host.append(scroller);
  let position = 10;
  Object.defineProperty(row, "getBoundingClientRect", {
    value: () => new DOMRect(0, position - scroller.scrollTop, 500, 40),
  });
  owner.rowScroll.set(row, scroller);
  const adjusted = vi.fn();
  owner.adjusted = adjusted;
  const first = owner.acquire(scroller, turn),
    nested = owner.acquire(scroller, turn);
  position = 35;
  first.changed();
  nested.changed();
  act(() => vi.advanceTimersToNextFrame());
  expect(scroller.scrollTop).toBe(25);
  expect(adjusted).toHaveBeenCalledTimes(1);
  first.release();
  expect(turn.dataset.transcriptVirtualizedTurn).toBe("true");
  nested.release();
  expect(turn.dataset.transcriptVirtualizedTurn).toBeUndefined();
  const inner = document.createElement("div");
  turn.append(inner);
  const local = owner.acquire(inner, turn);
  expect(turn.dataset.transcriptVirtualizedTurn).toBeUndefined();
  local.release();
});

it("virtualizes an expanded single turn's tool trail while exposing its exact search result", () => {
  let navigate: ((id: string | null, query?: string) => boolean) | null = null;
  const blocks: Block[] = [
    { id: "user", role: "user", text: "Inspect all files" },
    ...Array.from({ length: 2000 }, (_, index): Block => ({
      id: `tool-${index}`,
      role: "tool",
      text: `echo ${index}`,
      tool: { kind: "shell", status: index === 1990 ? "pending" : "completed" },
      approval: index === 1990 ? { requestId: 17 } : undefined,
    })),
    { id: "answer", role: "assistant", text: "Done" },
  ];
  act(() =>
    root.render(
      createElement(AgentTranscript, {
        blocks,
        onApproval: vi.fn(),
        onNavigateReady: (value) => {
          navigate = value;
        },
      }),
    ),
  );
  act(() => {
    expect(navigate?.("tool-1500", "echo")).toBe(true);
  });
  expect(host.querySelector('[data-transcript-virtual-block-id="tool-1500"]')).not.toBeNull();
  expect(
    host.querySelector('[data-transcript-virtual-block-id="tool-1990"]')?.textContent,
  ).toContain("Open this request in its conversation to respond.");
  expect(host.querySelectorAll("[data-transcript-virtual-owner]").length).toBeLessThan(100);
  expect(host.querySelector('[data-transcript-search-current="true"]')?.textContent).toContain(
    "1500",
  );
});

it("preserves selected DOM while a live list crosses the virtualization threshold", () => {
  const element = mount(rows(80));
  const original = host.querySelector<HTMLElement>('[data-transcript-virtual-block-id="block-0"]')!;
  const range = document.createRange();
  range.selectNodeContents(original);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  act(() => document.dispatchEvent(new Event("selectionchange")));
  mount(rows(1000));
  expect(host.querySelector('[data-transcript-virtual-block-id="block-0"]')).toBe(original);
  expect(selection.toString()).toBe("Row 0");
  expect(mounted()).toBeLessThan(50);
  scroll(element, 20_000);
  expect(original.isConnected).toBe(true);
});

it("materializes a native Select All range for Copy, then reclaims rows after clearing it", () => {
  mount(rows(500));
  const list = host.querySelector<HTMLElement>("[data-transcript-virtual-list]")!;
  const selection = window.getSelection()!;
  const range = document.createRange();
  range.selectNodeContents(list);
  selection.removeAllRanges();
  selection.addRange(range);
  act(() => document.dispatchEvent(new Event("copy")));
  expect(mounted()).toBe(500);
  expect(selection.toString()).toContain("Row 499");
  act(() => {
    selection.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
  });
  expect(mounted()).toBeLessThan(50);
});

it("restores an exact virtual block anchor after pooled DOM eviction", () => {
  vi.useFakeTimers();
  const pool = new TranscriptPool(12, undefined, 10, 1);
  const blocks: Block[] = [
    { id: "user", role: "user", text: "Inspect" },
    ...Array.from({ length: 1000 }, (_, index): Block => ({
      id: `tool-${index}`,
      role: "tool",
      text: `echo ${index}`,
      tool: { kind: "shell", status: "completed" },
    })),
    { id: "answer", role: "assistant", text: "Done" },
  ];
  let navigate: ((id: string | null) => boolean) | null = null;
  const render = (active: boolean) =>
    act(() =>
      root.render(
        createElement(
          "div",
          null,
          createElement(
            PooledTranscript,
            { pool, sessionId: "large" },
            createElement(AgentTranscript, {
              sessionId: "large",
              blocks,
              visible: active,
              onNavigateReady: (value) => {
                navigate = value;
              },
            }),
          ),
          createElement(
            PooledTranscript,
            { pool, sessionId: "other" },
            createElement(AgentTranscript, { sessionId: "other", blocks: [], visible: !active }),
          ),
          createElement(TranscriptPoolOutlet, { pool }),
        ),
      ),
    );
  render(true);
  act(() => navigate?.("tool-700"));
  act(() => vi.advanceTimersToNextFrame());
  const scroller = host.querySelector<HTMLElement>('[data-chat-citation-session="large"]')!;
  const target = scroller.querySelector<HTMLElement>(
    '[data-transcript-virtual-block-id="tool-700"]',
  )!;
  expect(target).not.toBeNull();
  act(() => {
    scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
    scroller.scrollTop = Math.max(0, scroller.scrollTop - 100);
    scroller.dispatchEvent(new Event("scroll"));
  });
  const saved = { ...pool.getSnapshot().find((entry) => entry.id === "large")!.uiState };
  expect(saved.virtualAnchorBlockId).toBeDefined();
  expect(saved.bottomFollow).toBe(false);
  render(false);
  act(() => vi.advanceTimersByTime(11));
  expect(scroller.isConnected).toBe(false);
  render(true);
  const restored = host.querySelector<HTMLElement>('[data-chat-citation-session="large"]')!;
  const row = [
    ...restored.querySelectorAll<HTMLElement>("[data-transcript-virtual-block-id]"),
  ].find((node) => node.dataset.transcriptVirtualBlockId === saved.virtualAnchorBlockId)!;
  expect(row).toBeDefined();
  expect(row.getBoundingClientRect().top - restored.getBoundingClientRect().top).toBeCloseTo(
    saved.virtualAnchorOffset!,
  );
});

it("measures a resized row above the viewport and preserves the actual visible row offset once", () => {
  vi.useFakeTimers();
  const observers: Array<{ callback: ResizeObserverCallback; targets: Set<Element> }> = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      entry: { callback: ResizeObserverCallback; targets: Set<Element> };
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
  const element = mount(rows(2000));
  scroll(element, 10_000);
  act(() => vi.advanceTimersToNextFrame());
  const anchor = owner.firstVisibleRow(element)!;
  const offset = anchor.getBoundingClientRect().top;
  const preceding = [
    ...element.querySelectorAll<HTMLElement>("[data-transcript-virtual-owner]"),
  ].find((node) => node.getBoundingClientRect().bottom <= 0)!;
  expect(preceding).toBeDefined();
  sizes.set(preceding.dataset.transcriptVirtualBlockId!, 80);
  act(() => {
    for (const observer of observers)
      if (observer.targets.has(preceding))
        observer.callback(
          [
            {
              target: preceding,
              contentRect: new DOMRect(0, 0, 500, 80),
              borderBoxSize: [{ inlineSize: 500, blockSize: 80 }],
            } as unknown as ResizeObserverEntry,
          ],
          {} as ResizeObserver,
        );
  });
  act(() => vi.advanceTimersToNextFrame());
  expect(anchor.isConnected).toBe(true);
  expect(anchor.getBoundingClientRect().top).toBeCloseTo(offset);
});

it("pins exact pending UI work until its real request promise settles, with idempotent release", () => {
  const element = mount(rows(1000));
  const original = host.querySelector<HTMLElement>('[data-transcript-virtual-block-id="block-0"]')!;
  let release!: () => void;
  act(() => {
    release = owner.holdBlock("block-0");
  });
  scroll(element, 50_000);
  expect(original.isConnected).toBe(true);
  act(() => {
    release();
    release();
  });
  expect(owner.activeBlocks.size).toBe(0);
  scroll(element, 51_000);
  expect(host.querySelector('[data-transcript-virtual-block-id="block-0"]')).toBeNull();
});

it("retains remote-output loading and failure across row culling without retrying automatically", async () => {
  let reject!: (reason: Error) => void;
  const pending = new Promise<void>((_resolve, failed) => {
    reject = failed;
  });
  const load = vi
    .fn()
    .mockImplementationOnce(() => pending)
    .mockResolvedValueOnce(undefined);
  let navigate: ((id: string | null) => boolean) | null = null;
  const blocks: Block[] = [
    { id: "user", role: "user", text: "Read" },
    ...Array.from({ length: 300 }, (_, index): Block => ({
      id: `a-${index}`,
      role: "assistant",
      text: `Answer ${index}`,
      ...(index === 0 ? { remoteContent: { revision: 7, bytes: 2048 } } : {}),
    })),
  ];
  act(() =>
    root.render(
      createElement(AgentTranscript, {
        blocks,
        onLoadRemoteBlock: load,
        onNavigateReady: (value) => {
          navigate = value;
        },
      }),
    ),
  );
  act(() => navigate?.("a-0"));
  const row = host.querySelector<HTMLElement>('[data-transcript-virtual-block-id="a-0"]')!;
  const button = [...row.querySelectorAll<HTMLButtonElement>("button")].find((node) =>
    node.textContent?.includes("Load full output"),
  )!;
  act(() => button.click());
  act(() => {
    navigate?.(null);
    button.blur();
  });
  const scroller = host.querySelector<HTMLElement>(".agent-transcript")!;
  scroll(scroller, 50_000);
  expect(row.isConnected).toBe(true);
  expect(row.textContent).toContain("Loading full output");
  await act(async () => {
    reject(new Error("offline"));
    await pending.catch(() => {});
  });
  scroll(scroller, 51_000);
  act(() => navigate?.("a-0"));
  const restored = host.querySelector<HTMLElement>('[data-transcript-virtual-block-id="a-0"]')!;
  expect(restored.textContent).toContain("Retry");
  expect(load).toHaveBeenCalledTimes(1);
  const retry = [...restored.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent === "Retry",
  )!;
  await act(async () => retry.click());
  expect(load).toHaveBeenCalledTimes(2);
  expect(load).toHaveBeenLastCalledWith("a-0", 7);
});

it("registers selectionchange tracking only for virtualized lists, keeping copy handling everywhere", () => {
  const add = vi.spyOn(document, "addEventListener");
  mount(rows(5));
  const plain = add.mock.calls.map(([type]) => type);
  expect(plain).not.toContain("selectionchange");
  expect(plain).toContain("copy");
  add.mockClear();
  act(() => root.unmount());
  root = createRoot(host);
  mount(rows(1000));
  expect(add.mock.calls.map(([type]) => type)).toContain("selectionchange");
});

function resizeHarness() {
  const callbacks: ResizeObserverCallback[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  let width = 500;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return new DOMRect(0, top(this), width, height(this));
  });
  return (next: number) => {
    width = next;
    act(() => {
      for (const callback of callbacks) callback([], {} as ResizeObserver);
    });
  };
}

it("re-measures rows once per width change outside a live resize", () => {
  const setWidth = resizeHarness();
  mount(rows(1000));
  measureCalls.count = 0;
  setWidth(450);
  setWidth(400);
  expect(measureCalls.count).toBe(2);
});

it("keeps measured row sizes through a live resize and re-measures once at its end", () => {
  const setWidth = resizeHarness();
  mount(rows(1000));
  measureCalls.count = 0;
  const end = beginResizeGesture();
  setWidth(450);
  setWidth(400);
  setWidth(350);
  expect(measureCalls.count).toBe(0);
  act(() => end());
  expect(measureCalls.count).toBe(1);
});
