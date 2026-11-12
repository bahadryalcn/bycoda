// @vitest-environment happy-dom
import { createElement, Profiler } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { registerStreamingTextUpdate } from "../model/stableBlocks";
import { AgentTranscript } from "./AgentTranscript";
import type { TranscriptVirtualRow } from "./TranscriptVirtualRows";

vi.mock("../hooks/useTranscriptLayout", () => ({ useTranscriptLayout: () => "full" }));
vi.mock("../hooks/useTranscriptAnchor", () => ({ useTranscriptAnchor: () => false }));
vi.mock("./AgentMarkdown", () => ({
  AgentMarkdown: ({ text }: { text: string }) => createElement("span", null, text),
}));
const rowRenders = vi.hoisted(() => new Map<string, number>());
vi.mock("./TranscriptVirtualRows", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./TranscriptVirtualRows")>();
  const wrappers = new WeakMap<TranscriptVirtualRow, TranscriptVirtualRow>();
  return {
    ...actual,
    TranscriptVirtualRows: (props: { rows: TranscriptVirtualRow[]; listId: string }) =>
      createElement(actual.TranscriptVirtualRows, {
        ...props,
        rows: props.rows.map((row) => {
          let wrapped = wrappers.get(row);
          if (!wrapped) {
            wrapped = {
              ...row,
              render: () => {
                rowRenders.set(row.id, (rowRenders.get(row.id) ?? 0) + 1);
                return row.render();
              },
            };
            wrappers.set(row, wrapped);
          }
          return wrapped;
        }),
      }),
  };
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("streaming frames", () => {
  it("keeps settled rows of the live turn out of text-only frame renders", () => {
    rowRenders.clear();
    let blocks: Block[] = [
      { id: "user", role: "user", text: "question" },
      { id: "settled-a", role: "assistant", text: "settled first" },
      { id: "settled-b", role: "assistant", text: "settled second" },
      { id: "live", role: "assistant", text: "live", streaming: true },
    ];
    const render = () =>
      flushSync(() =>
        root.render(
          createElement(AgentTranscript, {
            blocks,
            visible: true,
            busy: true,
            harness: undefined,
          }),
        ),
      );
    render();
    const first = rowRenders.get("settled-a");
    const second = rowRenders.get("settled-b");
    const prompt = rowRenders.get("user");
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(0);
    for (let frame = 0; frame < 5; frame++) {
      const next = blocks.slice();
      next[3] = { ...blocks[3], text: `${blocks[3].text} token` };
      registerStreamingTextUpdate(blocks, next, 3);
      blocks = next;
      render();
    }
    expect(rowRenders.get("settled-a")).toBe(first);
    expect(rowRenders.get("settled-b")).toBe(second);
    expect(rowRenders.get("user")).toBe(prompt);
    expect(container.textContent).toContain("live token token token token token");
    blocks = blocks.map((block) =>
      block.id === "settled-a" ? { ...block, text: "revised first" } : block,
    );
    render();
    expect(container.textContent).toContain("revised first");
    expect(container.textContent).not.toContain("settled first");
  });

  it("does not rescan every block per text-only frame", () => {
    let reads = 0;
    const base: Block[] = [];
    for (let i = 0; i < 40; i++) {
      const u: Block = { id: `u${i}`, role: "user", text: `q${i}` };
      Object.defineProperty(u, "role", {
        get() {
          reads++;
          return "user";
        },
        enumerable: true,
      });
      base.push(u, { id: `a${i}`, role: "assistant", text: `a${i}` });
    }
    base.push({ id: "last", role: "assistant", text: "x", streaming: true });
    let commits = 0;
    const render = (blocks: Block[]) =>
      flushSync(() =>
        root.render(
          createElement(
            Profiler,
            { id: "p", onRender: () => commits++ },
            createElement(AgentTranscript, {
              blocks,
              visible: true,
              busy: true,
              harness: undefined,
            }),
          ),
        ),
      );
    render(base);
    let prev = base;
    commits = 0;
    reads = 0;
    for (let i = 0; i < 50; i++) {
      const next = prev.slice();
      next[next.length - 1] = { ...prev[prev.length - 1], text: prev[prev.length - 1].text + "y" };
      registerStreamingTextUpdate(prev, next, next.length - 1);
      render(next);
      prev = next;
    }
    expect(commits).toBe(50);
    // Was ~94 user-role reads per frame (4700 / 50) before text-only frames skipped the whole-transcript scans.
    expect(reads / 50).toBeLessThan(25);
    expect(true).toBe(true);
  });
});
