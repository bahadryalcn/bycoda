// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { ActivityThinkingRow } from "./AgentTranscript";
import { PooledTranscript, TranscriptPool, TranscriptPoolOutlet } from "./TranscriptPool";

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let unmounted: string[];
function ThinkingProbe({ visible: _visible }: { visible?: boolean }) {
  return createElement(ActivityThinkingRow, {
    block: { id: "thought", role: "reasoning", text: "First paragraph.\n\nMore detail." },
    expandable: true,
  });
}
function Probe({
  id,
}: {
  id: string;
  visible?: boolean;
  busy?: boolean;
  pendingQuestion?: boolean;
  blocks?: Block[];
}) {
  useEffect(
    () => () => {
      unmounted.push(id);
    },
    [id],
  );
  return createElement("span", { "data-probe": id }, id);
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  unmounted = [];
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function show(
  pool: TranscriptPool,
  active: number,
  props: Record<number, Partial<Parameters<typeof Probe>[0]>> = {},
) {
  act(() =>
    root.render(
      createElement(
        "div",
        null,
        ...Array.from({ length: 6 }, (_, i) =>
          createElement(
            PooledTranscript,
            { key: i, pool, sessionId: String(i) },
            createElement(Probe, { id: String(i), visible: i === active, ...props[i] }),
          ),
        ),
        createElement(TranscriptPoolOutlet, { pool }),
      ),
    ),
  );
}
it("expires open hidden transcripts at three minutes and retains the last two visits", () => {
  const pool = new TranscriptPool();
  for (let i = 0; i < 6; i++) show(pool, i);
  act(() => vi.advanceTimersByTime(179999));
  expect(unmounted).toEqual([]);
  act(() => vi.advanceTimersByTime(1));
  expect(unmounted.sort()).toEqual(["0", "1", "2", "3"]);
  expect(
    pool
      .getSnapshot()
      .filter((entry) => entry.mounted)
      .map((entry) => entry.id),
  ).toEqual(["4", "5"]);
  show(pool, 0);
  expect(host.querySelector('[data-probe="0"]')).not.toBeNull();
});

it("never expires streaming, running, approval or question sessions, including host-running mirrors", () => {
  const pool = new TranscriptPool(12, undefined, 100, 1);
  const props = {
    0: { blocks: [{ id: "stream", role: "assistant", text: "partial", streaming: true } as Block] },
    1: { busy: true },
    2: {
      blocks: [
        {
          id: "approval",
          role: "tool",
          text: "approve",
          approval: { requestId: 1, decided: false },
        } as unknown as Block,
      ],
    },
    3: { pendingQuestion: true },
  };
  act(() => pool.setProtectedIds(["4"]));
  for (let i = 0; i < 6; i++) show(pool, i, props);
  act(() => vi.advanceTimersByTime(10000));
  expect(unmounted).toEqual([]);
  act(() => pool.setProtectedIds([]));
  expect(unmounted).toEqual(["4"]);
  // A new stream in an already sleeping transcript wakes it immediately.
  show(pool, 5, { ...props, 4: { busy: true } });
  expect(host.querySelector('[data-probe="4"]')).not.toBeNull();
});

it("retains nested disclosure state outside the released tree", () => {
  const pool = new TranscriptPool(12, undefined, 100, 1);
  const render = () =>
    act(() =>
      root.render(
        createElement(
          "div",
          null,
          createElement(
            PooledTranscript,
            { pool, sessionId: "thought" },
            createElement(ThinkingProbe),
          ),
          createElement(TranscriptPoolOutlet, { pool }),
        ),
      ),
    );
  render();
  act(() => host.querySelector<HTMLButtonElement>("button")!.click());
  const entry = pool.getSnapshot()[0];
  expect(entry.uiState.disclosures?.["ActivityThinkingRow:thought"]).toBe(true);
  // Drive the same host visibility transition used by a SessionPane.
  act(() => {
    pool.show("thought", entry.host!, createElement(ThinkingProbe, { visible: false }));
    pool.show(
      "other",
      document.createElement("div"),
      createElement(Probe, { id: "other", visible: true }),
    );
    vi.advanceTimersByTime(100);
  });
  expect(host.querySelector("button")).toBeNull();
  render();
  expect(host.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
});

it("protects parked running sessions beyond the cache budget, then uses live idle state to release them", () => {
  const pool = new TranscriptPool(0, undefined, 100, 1);
  show(pool, 0, { 0: { busy: true } });
  const entry = pool.getSnapshot().find((item) => item.id === "0")!;
  act(() => {
    pool.setProtectedIds(["0"], ["0"]);
    pool.park("0", entry.host!);
  });
  show(pool, 5, { 0: { busy: true } });
  const current = pool.getSnapshot().find((item) => item.id === "0")!;
  act(() => pool.park("0", current.host!));
  act(() => vi.advanceTimersByTime(1000));
  expect(unmounted).not.toContain("0");
  act(() => pool.setProtectedIds([], ["0"]));
  expect(unmounted).toContain("0");
});
