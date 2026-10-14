// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetGitIndexStore } from "../model/gitIndexStore";
import { WorkingTreeDiff } from "./WorkingTreeDiff";
import { CommitDiff } from "./CommitDiff";
import { SessionChangesDiff } from "./SessionChangesDiff";
import type { UnifiedDiffView } from "./UnifiedDiffView";

const api = vi.hoisted(() => ({
  index: vi.fn(),
  diff: vi.fn(),
  stage: vi.fn(),
  discard: vi.fn(),
  hunk: vi.fn(),
  notify: vi.fn(),
  ask: vi.fn(),
  commitFiles: vi.fn(),
  checkpoint: vi.fn(),
  checkpointDiff: vi.fn(),
  view: vi.fn(),
}));
vi.mock("../../../platform/tauri/fs", () => ({
  gitDiffFiles: api.index,
  gitFileDiff: api.diff,
  gitStageFile: api.stage,
  gitDiscardFile: api.discard,
  gitStageContents: api.hunk,
  notifyGitChanged: api.notify,
  subscribeGitChanged: () => () => {},
  basename: (path: string) => path.split("/").pop(),
  gitCommitFiles: api.commitFiles,
  gitCommitFileDiff: api.diff,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: api.ask }));
vi.mock("../../sessions/model/checkpoint", () => ({
  sessionCheckpointStatus: api.checkpoint,
  sessionCheckpointFileDiff: api.checkpointDiff,
  subscribeReviewChanged: () => () => {},
}));
vi.mock("./UnifiedDiffView", () => ({
  UnifiedDiffView: (props: Parameters<typeof UnifiedDiffView>[0]) => {
    api.view(props);
    return createElement(
      "div",
      null,
      props.files.map((file) => createElement("span", { key: file.id }, file.label)),
    );
  },
}));

let container: HTMLDivElement;
let root: Root;
const files = ["a.txt", "b.txt"].map((relative) => ({
  relative,
  path: relative,
  status: "modified",
  staged: false,
  unstaged: true,
  additions: 1,
  deletions: 1,
}));
function props(): Parameters<typeof UnifiedDiffView>[0] {
  return api.view.mock.calls[api.view.mock.calls.length - 1][0];
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  resetGitIndexStore();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  api.index.mockResolvedValue({ files });
  api.diff.mockResolvedValue({
    original: "old\n",
    current: "new\n",
    binary: false,
    tooLarge: false,
  });
  api.checkpoint.mockResolvedValue({ files });
  api.checkpointDiff.mockReset().mockImplementation(api.diff);
  api.stage.mockResolvedValue(undefined);
  api.discard.mockResolvedValue(undefined);
  api.ask.mockResolvedValue(true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("serializes stage and hunk mutations and keeps the current operation busy", async () => {
  await act(async () => root.render(createElement(WorkingTreeDiff, { cwd: "/repo" })));
  const first = deferred<void>();
  const second = deferred<void>();
  api.stage.mockReturnValueOnce(first.promise);
  api.hunk.mockReturnValueOnce(second.promise);
  const view = props();
  let one!: Promise<void>;
  let two!: Promise<void>;
  await act(async () => {
    one = view.onStageFile!(view.files[0].id) as unknown as Promise<void>;
    two = view.onStageHunk!(view.files[1].id, 0) as unknown as Promise<void>;
    await Promise.resolve();
  });
  expect(api.stage).toHaveBeenCalledTimes(1);
  expect(api.hunk).not.toHaveBeenCalled();
  expect(props().busyId).toBe(view.files[0].id);
  await act(async () => {
    first.resolve();
    await one;
  });
  expect(api.hunk).toHaveBeenCalledTimes(1);
  expect(props().busyId).toBe(view.files[1].id);
  await act(async () => {
    second.resolve();
    await two;
  });
  expect(props().busyId).toBeNull();
  expect(api.notify).toHaveBeenCalledTimes(2);
});

it.each(["modified", "untracked"])(
  "confirms %s discard and does nothing on cancel",
  async (status) => {
    api.index.mockResolvedValue({ files: [{ ...files[0], status }] });
    api.ask.mockResolvedValue(false);
    await act(async () => root.render(createElement(WorkingTreeDiff, { cwd: "/repo" })));
    await act(async () => {
      await props().onDiscardFile!(props().files[0].id);
    });
    expect(api.ask.mock.calls[0][0]).toContain(
      status === "untracked" ? "Delete untracked file a.txt?" : "Discard changes in a.txt?",
    );
    expect(api.discard).not.toHaveBeenCalled();
    expect(api.notify).not.toHaveBeenCalled();
  },
);

it("shows a failed mutation and allows another attempt", async () => {
  api.stage.mockRejectedValueOnce(new Error("index.lock exists"));
  await act(async () => root.render(createElement(WorkingTreeDiff, { cwd: "/repo" })));
  await act(async () => {
    await props().onStageFile!(props().files[0].id);
  });
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("index.lock exists");
  expect(api.notify).not.toHaveBeenCalled();
  expect(container.textContent).toContain("a.txt");
  await act(async () => {
    await props().onStageFile!(props().files[0].id);
  });
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(api.notify).toHaveBeenCalledTimes(1);
});

it("changes session focus without reloading the status or file diffs", async () => {
  await act(async () =>
    root.render(
      createElement(SessionChangesDiff, {
        cwd: "/repo",
        sessionId: "s1",
        focusPath: "a.txt",
      }),
    ),
  );
  expect(api.checkpoint).toHaveBeenCalledTimes(1);
  expect(api.checkpointDiff).toHaveBeenCalledTimes(2);
  await act(async () =>
    root.render(
      createElement(SessionChangesDiff, {
        cwd: "/repo",
        sessionId: "s1",
        focusPath: "b.txt",
      }),
    ),
  );
  expect(api.checkpoint).toHaveBeenCalledTimes(1);
  expect(api.checkpointDiff).toHaveBeenCalledTimes(2);
  expect(props().focusPath).toBe("b.txt");
});

it("prioritizes a newly focused pending file without restarting in-flight loads", async () => {
  const many = Array.from({ length: 6 }, (_, index) => ({
    ...files[0],
    relative: `${index}.txt`,
    path: `${index}.txt`,
  }));
  api.checkpoint.mockResolvedValue({ files: many });
  const first = deferred<Awaited<ReturnType<typeof api.diff>>>();
  api.checkpointDiff.mockReturnValue(first.promise);
  await act(async () =>
    root.render(
      createElement(SessionChangesDiff, {
        cwd: "/repo",
        sessionId: "s1",
        focusPath: "0.txt",
      }),
    ),
  );
  expect(api.checkpointDiff).toHaveBeenCalledTimes(4);
  await act(async () =>
    root.render(
      createElement(SessionChangesDiff, {
        cwd: "/repo",
        sessionId: "s1",
        focusPath: "5.txt",
      }),
    ),
  );
  expect(api.checkpoint).toHaveBeenCalledTimes(1);
  api.checkpointDiff.mockImplementation(api.diff);
  await act(async () => {
    first.resolve(await api.diff());
    await first.promise;
  });
  expect(api.checkpointDiff.mock.calls[4][2]).toBe("5.txt");
  expect(api.checkpointDiff).toHaveBeenCalledTimes(6);
});

it("runs confirmed discard and reports a failed hunk without hiding the diff", async () => {
  await act(async () => root.render(createElement(WorkingTreeDiff, { cwd: "/repo" })));
  await act(async () => {
    await props().onDiscardFile!(props().files[0].id);
  });
  expect(api.discard).toHaveBeenCalledWith("/repo", "a.txt");
  expect(api.notify).toHaveBeenCalledTimes(1);
  api.hunk.mockRejectedValueOnce(new Error("hunk failed"));
  await act(async () => {
    await props().onStageHunk!(props().files[1].id, 0);
  });
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("hunk failed");
  expect(container.textContent).toContain("b.txt");
  expect(api.notify).toHaveBeenCalledTimes(1);
});

it.each(["working", "session"])("clears the %s load error and retries", async (kind) => {
  const load = kind === "working" ? api.index : api.checkpoint;
  const render = (cwd: string) =>
    kind === "working"
      ? createElement(WorkingTreeDiff, { cwd })
      : createElement(SessionChangesDiff, { cwd, sessionId: "s1" });
  load.mockRejectedValueOnce(new Error("old failure"));
  await act(async () => root.render(render("/repo")));
  expect(container.textContent).toContain("old failure");
  const pending = deferred<{ files: typeof files }>();
  load.mockReturnValueOnce(pending.promise);
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(container.textContent).not.toContain("old failure");
  await act(async () => {
    pending.resolve({ files });
    await pending.promise;
  });
  expect(container.textContent).toContain("a.txt");
  load.mockRejectedValueOnce(new Error("second failure"));
  await act(async () => root.render(render("/other")));
  expect(container.textContent).toContain("second failure");
  await act(async () => root.render(render("~")));
  expect(container.textContent).toBe("No project folder");
});

it("clears a previous commit's error while a new commit loads and provides retry", async () => {
  api.commitFiles.mockRejectedValueOnce(new Error("old failure"));
  await act(async () => root.render(createElement(CommitDiff, { cwd: "/repo", sha: "aaaa" })));
  expect(container.textContent).toContain("old failure");
  expect(container.querySelector("button")?.textContent).toBe("Retry");
  const next = deferred<typeof files>();
  api.commitFiles.mockReturnValueOnce(next.promise);
  await act(async () => root.render(createElement(CommitDiff, { cwd: "/repo", sha: "bbbb" })));
  expect(container.textContent).not.toContain("old failure");
  await act(async () => {
    next.resolve(files);
    await next.promise;
  });
  expect(container.textContent).toContain("a.txt");
});
