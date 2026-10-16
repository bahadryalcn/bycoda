// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { AgentTranscript } from "./AgentTranscript";
import { PooledTranscript, TranscriptPool, TranscriptPoolOutlet } from "./TranscriptPool";

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let rowHeight: number;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  rowHeight = 100;
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function () {
    return this.classList.contains("agent-transcript") ? 500 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function () {
    return this.classList.contains("agent-transcript")
      ? this.querySelectorAll("[data-transcript-turn]").length * rowHeight
      : 0;
  });
  // happy-dom does not clamp scrollTop as browsers do when pinToBottom writes
  // scrollHeight. Model that browser contract for both following and anchoring.
  const positions = new WeakMap<HTMLElement, number>();
  vi.spyOn(HTMLElement.prototype, "scrollTop", "get").mockImplementation(function () {
    return positions.get(this) ?? 0;
  });
  vi.spyOn(HTMLElement.prototype, "scrollTop", "set").mockImplementation(function (value) {
    positions.set(
      this,
      this.classList.contains("agent-transcript")
        ? Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight))
        : value,
    );
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
    const id = this.dataset.transcriptTurn;
    const top = id
      ? Number(id.slice(2)) * rowHeight - (this.closest(".agent-transcript")?.scrollTop ?? 0)
      : 0;
    return {
      top,
      bottom: top + (id ? rowHeight : 500),
      left: 0,
      right: 500,
      width: 500,
      height: id ? rowHeight : 500,
      x: 0,
      y: top,
      toJSON() {},
    };
  });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const blocks: Block[] = Array.from({ length: 100 }, (_, i) => [
  { id: `u-${i}`, role: "user" as const, text: `Question ${i}` },
  { id: `a-${i}`, role: "assistant" as const, text: `Answer ${i}` },
]).flat();

it("restores loaded history and a turn-relative offset after earlier rows change height", () => {
  const pool = new TranscriptPool(12, undefined, 100, 1);
  let reveal: ((id: string) => boolean) | null = null;
  let navigate: ((id: string | null, query?: string) => boolean) | null = null;
  const render = (active: boolean) =>
    act(() =>
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(
            PooledTranscript,
            { pool, sessionId: "history" },
            createElement(AgentTranscript, {
              sessionId: "history",
              blocks,
              visible: active,
              onRevealReady: (fn) => {
                reveal = fn;
              },
              onNavigateReady: (fn) => {
                navigate = fn;
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
  act(() => reveal!("u-0"));
  const scroller = host.querySelector<HTMLElement>(".agent-transcript")!;
  act(() => {
    scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
    scroller.scrollTop = 4250;
    scroller.dispatchEvent(new Event("scroll"));
  });
  const saved = pool.getSnapshot().find((entry) => entry.id === "history")!.uiState;
  expect(saved).toMatchObject({
    anchorId: "u-42",
    anchorOffset: -50,
    bottomFollow: false,
    visibleTurnCount: 100,
    firstLoadedTurnId: "u-0",
    lastLoadedTurnId: "u-99",
  });
  render(false);
  expect(navigate).toBeNull();
  expect(reveal).toBeNull();
  act(() => vi.advanceTimersByTime(101));
  expect(scroller.isConnected).toBe(false);
  rowHeight = 150;
  render(true);
  const restored = host.querySelector<HTMLElement>(".agent-transcript")!;
  expect(restored).not.toBe(scroller);
  expect(restored.querySelectorAll("[data-transcript-turn]")).toHaveLength(100);
  expect(restored.scrollTop).toBe(6350);
  expect(navigate).toBeTypeOf("function");
});

it("restores bottom following when an evicted transcript is reopened", () => {
  const pool = new TranscriptPool(12, undefined, 100, 1);
  const render = (active: boolean) =>
    act(() =>
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(
            PooledTranscript,
            { pool, sessionId: "bottom" },
            createElement(AgentTranscript, { blocks, visible: active }),
          ),
          createElement(
            PooledTranscript,
            { pool, sessionId: "other" },
            createElement(AgentTranscript, { blocks: [], visible: !active }),
          ),
          createElement(TranscriptPoolOutlet, { pool }),
        ),
      ),
    );
  render(true);
  render(false);
  act(() => vi.advanceTimersByTime(101));
  rowHeight = 200;
  render(true);
  const restored = host.querySelector<HTMLElement>(".agent-transcript")!;
  expect(restored.scrollTop).toBe(restored.scrollHeight - restored.clientHeight);
  expect(pool.getSnapshot().find((entry) => entry.id === "bottom")!.uiState.bottomFollow).toBe(
    true,
  );
});
