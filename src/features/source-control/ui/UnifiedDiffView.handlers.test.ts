// @vitest-environment happy-dom
import { Storage } from "happy-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildUnifiedFile } from "../model/unifiedDiff";
import { UnifiedDiffView, type UnifiedDiffFileModel } from "./UnifiedDiffView";

const flatten = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../model/unifiedDiffWindow", async (importOriginal) => {
  const original = await importOriginal<typeof import("../model/unifiedDiffWindow")>();
  return {
    ...original,
    flattenVisibleRows: (...args: Parameters<typeof original.flattenVisibleRows>) => {
      flatten.calls += 1;
      return original.flattenVisibleRows(...args);
    },
  };
});

function model(id: string): UnifiedDiffFileModel {
  const diff = buildUnifiedFile("a\nb\nc", `${id}\nb\nd`);
  return {
    id,
    path: `${id}.txt`,
    label: `${id}.txt`,
    additions: diff.additions,
    deletions: diff.deletions,
    blocks: diff.blocks,
    canStage: true,
    canStageHunk: true,
  };
}

describe("UnifiedDiffView handler identity", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("localStorage", new Storage());
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    flatten.calls = 0;
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("keeps rows when a caller passes fresh handlers with the same files", async () => {
    const files = [model("one"), model("two")];
    const render = (onStageHunk: () => void) =>
      act(async () =>
        root.render(
          createElement(UnifiedDiffView, {
            files,
            onStageHunk,
            onStageFile: () => {},
            onDiscardFile: () => {},
            onSectionNeeded: () => {},
          }),
        ),
      );
    await render(() => {});
    const built = flatten.calls;
    expect(built).toBeGreaterThanOrEqual(files.length);

    await render(() => {});
    await render(() => {});
    expect(flatten.calls).toBe(built);
  });

  it("rebuilds rows only when the staging handler appears or disappears", async () => {
    const files = [model("one")];
    const first = vi.fn();
    const second = vi.fn();
    const render = (onStageHunk?: (id: string, pos: number) => void) =>
      act(async () => root.render(createElement(UnifiedDiffView, { files, onStageHunk })));
    await render(first);
    const staged = flatten.calls;
    await render(second);
    expect(flatten.calls).toBe(staged);
    await render(undefined);
    expect(flatten.calls).toBe(staged + 1);
  });
});
