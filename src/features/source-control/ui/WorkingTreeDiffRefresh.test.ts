// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkingTreeDiff } from "./WorkingTreeDiff";
import type { UnifiedDiffView } from "./UnifiedDiffView";
import { notifyGitChangedWith, resetGitIndexStore } from "../model/gitIndexStore";

const api = vi.hoisted(() => ({
  files: vi.fn(),
  diff: vi.fn(),
  view: vi.fn(),
  listeners: new Set<() => void>(),
}));
vi.mock("../../../platform/tauri/fs", () => ({
  gitDiffFiles: api.files,
  gitDiffIndex: api.files,
  gitFileDiff: api.diff,
  gitStageFile: vi.fn(),
  gitDiscardFile: vi.fn(),
  gitStageContents: vi.fn(),
  notifyGitChanged: () => {
    for (const listener of [...api.listeners]) listener();
  },
  subscribeGitChanged: (listener: () => void) => {
    api.listeners.add(listener);
    return () => api.listeners.delete(listener);
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));
vi.mock("./UnifiedDiffView", () => ({
  UnifiedDiffView: (props: Parameters<typeof UnifiedDiffView>[0]) => {
    api.view(props);
    return createElement("div");
  },
}));

const CWD = "/repo";
let container: HTMLDivElement;
let root: Root;
let rows: ReturnType<typeof row>[];

function row(name: string, additions = 1) {
  return {
    path: `${CWD}/${name}`,
    relative: name,
    status: "modified",
    staged: false,
    unstaged: true,
    additions,
    deletions: 1,
  };
}
function models() {
  return api.view.mock.calls[api.view.mock.calls.length - 1][0].files;
}
async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  resetGitIndexStore();
  rows = Array.from({ length: 200 }, (_, i) => row(`f${i}.ts`));
  api.files.mockImplementation(async () => ({ head: "h1", files: rows }));
  api.diff.mockImplementation(async (_cwd: string, relative: string) => ({
    original: `old ${relative}\n`,
    current: `new ${relative}\n`,
    binary: false,
    tooLarge: false,
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(WorkingTreeDiff, { cwd: CWD }));
  });
  // The next change arrives a poll interval later.
  await settle(2000);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const EAGER = 10;
const id = (i: number) => `unstaged:f${i}.ts`;
function need(i: number, needed = true) {
  const props = api.view.mock.calls[api.view.mock.calls.length - 1][0];
  act(() => props.onSectionNeeded?.(id(i), needed));
}

it("opens with only the eager budget loaded, then only the file whose row moved", async () => {
  expect(api.diff).toHaveBeenCalledTimes(EAGER);
  const before = models();
  before.forEach((m, i) => {
    if (i < EAGER) expect(m.emptyMessage).toBeUndefined();
    else {
      // Placeholder with the index counts until the section is seen.
      expect(m.emptyMessage).toBe("Loading…");
      expect(m.additions).toBe(1);
    }
  });
  api.diff.mockClear();
  api.files.mockClear();

  rows = rows.map((r, i) => (i === 7 ? row("f7.ts", 2) : r));
  api.diff.mockImplementation(async () => ({
    original: "old f7\n",
    current: "new f7 edited\n",
    binary: false,
    tooLarge: false,
  }));
  act(() => {
    notifyGitChangedWith(CWD, "index", {
      observed: true,
      paths: [`${CWD}/f7.ts`],
    });
  });
  await settle(600);

  expect(api.files).toHaveBeenCalledTimes(1);
  expect(api.diff).toHaveBeenCalledTimes(1);
  expect(api.diff.mock.calls[0][1]).toBe("f7.ts");
  const after = models();
  after.forEach((model, i) => {
    if (i === 7) expect(model).not.toBe(before[i]);
    else expect(model).toBe(before[i]);
  });
});

it("loads a section once it is reported needed, and not again", async () => {
  api.diff.mockClear();
  need(50);
  await settle(0);
  expect(api.diff).toHaveBeenCalledTimes(1);
  expect(api.diff.mock.calls[0][1]).toBe("f50.ts");
  expect(models()[50].emptyMessage).toBeUndefined();
  need(50);
  await settle(0);
  expect(api.diff).toHaveBeenCalledTimes(1);
});

it("leaves a moved off-screen file unloaded until it is needed", async () => {
  api.diff.mockClear();
  rows = rows.map((r, i) => (i === 150 ? row("f150.ts", 5) : r));
  act(() => {
    notifyGitChangedWith(CWD, "index", {
      observed: true,
      paths: [`${CWD}/f150.ts`],
    });
  });
  await settle(600);
  expect(api.diff).not.toHaveBeenCalled();
  expect(models()[150].additions).toBe(5);
  need(150);
  await settle(0);
  expect(api.diff).toHaveBeenCalledTimes(1);
  expect(api.diff.mock.calls[0][1]).toBe("f150.ts");
});

it("reloads a loaded, needed file whose row moved, but not once it is no longer needed", async () => {
  need(50);
  await settle(0);
  api.diff.mockClear();
  const move = async (count: number) => {
    rows = rows.map((r, i) => (i === 50 ? row("f50.ts", count) : r));
    act(() => {
      notifyGitChangedWith(CWD, "index", {
        observed: true,
        paths: [`${CWD}/f50.ts`],
      });
    });
    await settle(600);
  };
  await move(2);
  expect(api.diff).toHaveBeenCalledTimes(1);
  need(50, false);
  api.diff.mockClear();
  await move(3);
  expect(api.diff).not.toHaveBeenCalled();
  need(50);
  await settle(0);
  expect(api.diff).toHaveBeenCalledTimes(1);
});

it("reloads a named file whose row did not change, and keeps its model when the text is the same", async () => {
  const before = models();
  api.diff.mockClear();
  act(() => {
    notifyGitChangedWith(CWD, "index", { paths: [`${CWD}/f3.ts`] });
  });
  await settle(600);
  expect(api.diff).toHaveBeenCalledTimes(1);
  expect(models()[3]).toBe(before[3]);
});

it("on an unhinted change refetches only eager and needed files, without touching what is on screen", async () => {
  need(50);
  need(80);
  await settle(0);
  need(80, false);
  const before = models();
  api.diff.mockClear();
  act(() => {
    notifyGitChangedWith(CWD, "refs", {});
  });
  await settle(600);
  // The 10 eager files and f50 (still needed); f80 is dirty but off-screen.
  expect(api.diff).toHaveBeenCalledTimes(EAGER + 1);
  const refetched = api.diff.mock.calls.map((call) => call[1]).sort();
  expect(refetched).toContain("f50.ts");
  expect(refetched).not.toContain("f80.ts");
  models().forEach((model, i) => expect(model).toBe(before[i]));
  api.diff.mockClear();
  need(80);
  await settle(0);
  expect(api.diff).toHaveBeenCalledTimes(1);
  expect(api.diff.mock.calls[0][1]).toBe("f80.ts");
});

it("coalesces a burst of events into one refresh", async () => {
  api.files.mockClear();
  act(() => {
    for (let i = 0; i < 5; i += 1) {
      notifyGitChangedWith(CWD, "index", { observed: true, paths: [] });
    }
  });
  await settle(200);
  expect(api.files).not.toHaveBeenCalled();
  await settle(400);
  expect(api.files).toHaveBeenCalledTimes(1);
});
