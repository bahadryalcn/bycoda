// @vitest-environment happy-dom
import { createElement, Profiler } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { registerStreamingTextUpdate } from "../model/stableBlocks";
import { AgentTranscript } from "./AgentTranscript";

vi.mock("../hooks/useTranscriptLayout", () => ({ useTranscriptLayout: () => "full" }));
vi.mock("../hooks/useTranscriptAnchor", () => ({ useTranscriptAnchor: () => false }));

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
