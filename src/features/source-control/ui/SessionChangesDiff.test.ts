// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SessionChangesDiff } from "./SessionChangesDiff";
import type { UnifiedDiffFileModel } from "./UnifiedDiffView";

const api = vi.hoisted(() => ({
  status: vi.fn(),
  diff: vi.fn(),
  worker: vi.fn(),
  changed: (_id?: string) => {},
  models: [] as UnifiedDiffFileModel[],
}));
vi.mock("../../sessions/public/checkpoint", () => ({
  sessionCheckpointStatus: api.status,
  sessionCheckpointFileDiff: api.diff,
  subscribeReviewChanged: (changed: typeof api.changed) => {
    api.changed = changed;
    return () => {};
  },
}));
vi.mock("../model/diffWorker", () => ({
  runDiffWorker: (_remote: unknown, fallback: () => unknown) => {
    api.worker();
    return fallback();
  },
}));
vi.mock("./UnifiedDiffView", () => ({
  UnifiedDiffView: ({ files }: { files: UnifiedDiffFileModel[] }) => {
    api.models = files;
    return null;
  },
}));

it("reuses parsed models per content while fetching every file on each review event", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  let files = ["a", "b"].map((relative) => ({
    relative,
    path: relative,
    additions: 1,
    deletions: 1,
  }));
  let current = "new\n";
  let binary = false;
  let tooLarge = false;
  api.status.mockImplementation(async () => ({ files: files.map((file) => ({ ...file })) }));
  api.diff.mockImplementation(async (_session: string, _cwd: string, relative: string) => ({
    original: "old\n",
    current: relative === "a" ? current : "new\n",
    binary: relative === "a" && binary,
    tooLarge: relative === "a" && tooLarge,
  }));
  const root = createRoot(document.createElement("div"));
  const refresh = async () => {
    await act(async () => {
      api.changed("s");
      await vi.advanceTimersByTimeAsync(500);
    });
  };
  try {
    await act(async () =>
      root.render(createElement(SessionChangesDiff, { cwd: "/repo", sessionId: "s" })),
    );
    const first = api.models;
    expect(api.worker).toHaveBeenCalledTimes(2);
    await refresh();
    expect(api.diff).toHaveBeenCalledTimes(4);
    expect(api.worker).toHaveBeenCalledTimes(2);
    expect(api.models[0]).toBe(first[0]);
    expect(api.models[1]).toBe(first[1]);
    current = "different\n";
    await refresh();
    expect(api.worker).toHaveBeenCalledTimes(3);
    expect(api.models[0]).not.toBe(first[0]);
    expect(api.models[1]).toBe(first[1]);
    const changed = api.models[0];
    files = [files[1]];
    await refresh();
    expect(api.models.map((file) => file.id)).toEqual(["b"]);
    files = [{ relative: "a", path: "a", additions: 1, deletions: 1 }, ...files];
    current = "returned\n";
    await refresh();
    expect(api.models[0]).not.toBe(changed);
    expect(api.worker).toHaveBeenCalledTimes(4);
    api.diff.mockRejectedValueOnce(new Error("offline"));
    await refresh();
    expect(api.models[0].emptyMessage).toBe("offline");
    await refresh();
    expect(api.models[0].emptyMessage).toBeUndefined();
    expect(api.models[1]).toBe(first[1]);
    binary = true;
    await refresh();
    expect(api.models[0].binary).toBe(true);
    expect(api.models[0].blocks).toEqual([]);
    expect(api.models[0].additions).toBe(1);
    const binaryModel = api.models[0];
    await refresh();
    expect(api.models[0]).toBe(binaryModel);
    binary = false;
    tooLarge = true;
    files = files.map((file) =>
      file.relative === "a" ? { ...file, path: "renamed/a", additions: 9 } : file,
    );
    await refresh();
    expect(api.models[0].tooLarge).toBe(true);
    expect(api.models[0].additions).toBe(9);
    expect(api.models[0].path).toBe("renamed/a");
    expect(api.models[1]).toBe(first[1]);
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
