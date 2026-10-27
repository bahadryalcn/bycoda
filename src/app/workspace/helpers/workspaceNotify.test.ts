import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notifyGitChanged: vi.fn(),
  notifyDirsChanged: vi.fn(),
  invalidateProjectFiles: vi.fn(),
  nudgeWatchedFiles: vi.fn(),
  invalidateWatchedFiles: vi.fn(),
  prepare: vi.fn(async () => {}),
  capture: vi.fn(async () => {}),
  fileChanges: vi.fn(async () => {}),
  notifyReviewChanged: vi.fn(),
}));
vi.mock("../../../platform/tauri/fs", () => ({ notifyGitChanged: mocks.notifyGitChanged }));
vi.mock("../../../features/files/model/fileTree", () => ({
  notifyDirsChanged: mocks.notifyDirsChanged,
}));
vi.mock("../../../features/files/model/fileIndex", () => ({
  invalidateProjectFiles: mocks.invalidateProjectFiles,
}));
vi.mock("../../../features/files/model/fileWatch", () => ({
  nudgeWatchedFiles: mocks.nudgeWatchedFiles,
  invalidateWatchedFiles: mocks.invalidateWatchedFiles,
}));
vi.mock("../../../features/sessions/model/checkpoint", () => ({
  prepareSessionCheckpoint: mocks.prepare,
  captureSessionCheckpoint: mocks.capture,
  captureSessionFileChanges: mocks.fileChanges,
  notifyReviewChanged: mocks.notifyReviewChanged,
}));
import { notifyFinishedWorkspace, nudgeOpenEditors, trackSessionEdits } from "./workspaceNotify";
import type { HarnessEvent } from "../../../integrations/harness";
import { mapCodexNotification } from "../../../integrations/harness/providers/codex/codexProtocol";

const defer = (callback: () => void, delay: number) => void setTimeout(callback, delay);
const shell = (callId: string): HarnessEvent =>
  ({ type: "tool.updated", callId, kind: "execute", status: "completed" }) as HarnessEvent;
const edit = (status?: string): HarnessEvent =>
  ({
    type: "tool.updated",
    callId: "edit-1",
    kind: "edit",
    title: "Edit src/a.ts",
    status,
    paths: ["src/a.ts"],
  }) as HarnessEvent;

beforeEach(() => {
  vi.useFakeTimers();
  Object.values(mocks).forEach((mock) => mock.mockClear());
});
afterEach(() => vi.useRealTimers());

it("refreshes git and the file tree once after a burst of finished tool calls", () => {
  for (let index = 0; index < 8; index += 1) nudgeOpenEditors(shell(`c${index}`), "/repo", defer);
  expect(mocks.notifyGitChanged).not.toHaveBeenCalled();
  vi.advanceTimersByTime(500);
  expect(mocks.notifyGitChanged).toHaveBeenCalledOnce();
  expect(mocks.notifyGitChanged).toHaveBeenCalledWith("/repo", "index");
  expect(mocks.notifyDirsChanged).toHaveBeenCalledOnce();
  // Open editors are still told right away.
  expect(mocks.nudgeWatchedFiles).toHaveBeenCalled();
});

it("lets the turn's own refresh replace a pending per-tool one", () => {
  nudgeOpenEditors(shell("c1"), "/repo", defer);
  notifyFinishedWorkspace("s", "/repo", defer, "git-first");
  expect(mocks.notifyGitChanged).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(1000);
  expect(mocks.notifyGitChanged).toHaveBeenCalledOnce();
});

it("takes one pre-edit checkpoint per streaming edit call", () => {
  for (let index = 0; index < 5; index += 1) trackSessionEdits("s", "/repo", edit("in_progress"));
  expect(mocks.prepare).toHaveBeenCalledOnce();
  trackSessionEdits("s", "/repo", edit("completed"));
  expect(mocks.capture).toHaveBeenCalledOnce();
  // The same call id streaming again after completion is a new edit.
  trackSessionEdits("s", "/repo", edit("in_progress"));
  expect(mocks.prepare).toHaveBeenCalledTimes(2);
});

it("records completed Codex DeleteFile/AddFile proof without sampling the post-write disk", () => {
  for (const { id, kind, diff } of [
    { id: "delete", kind: "delete", diff: "0\n" },
    { id: "add", kind: "add", diff: "1\n" },
  ]) {
    for (const method of ["item/started", "item/completed"]) {
      const mapped = mapCodexNotification(method, {
        item: {
          id,
          type: "fileChange",
          status: method === "item/completed" ? "completed" : "inProgress",
          changes: [{ path: "counter.txt", kind: { type: kind }, diff }],
        },
      });
      for (const event of mapped.events) trackSessionEdits("proof-session", "/repo", event);
    }
  }
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.capture).not.toHaveBeenCalled();
  expect(mocks.fileChanges.mock.calls).toEqual([
    [
      "proof-session",
      "/repo",
      "delete",
      [{ path: "counter.txt", kind: "delete", contents: "0\n" }],
    ],
    ["proof-session", "/repo", "add", [{ path: "counter.txt", kind: "add", contents: "1\n" }]],
  ]);
});

it("does not capture incomplete, failed or in-progress post-write file notifications", () => {
  for (const status of ["in_progress", "failed", "cancelled"]) {
    const event = edit(status);
    trackSessionEdits("incomplete-proof", "/repo", { ...event, fileChanges: [] } as HarnessEvent);
  }
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.capture).not.toHaveBeenCalled();
  expect(mocks.fileChanges).not.toHaveBeenCalled();
});
