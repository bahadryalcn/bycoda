// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const status = vi.hoisted(() => vi.fn());
vi.mock("./workspaceClient", () => {
  class WorkspaceCapabilityError extends Error {}
  return {
    WorkspaceCapabilityError,
    workspacePrepareStatus: status,
    workspacePrepareCancel: vi.fn(),
  };
});

import {
  MAX_POLL_FAILURES,
  finishedStages,
  useCreationProgress,
  type CreationProgressView,
} from "./creationProgress";
import { WorkspaceCapabilityError } from "./workspaceClient";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let view: CreationProgressView;
function Probe({ id }: { id: string | null }) {
  view = useCreationProgress(id);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  status.mockReset();
});
afterEach(() => vi.useRealTimers());

it("polls while running, tolerates a failed poll and stops when done", async () => {
  status
    .mockRejectedValueOnce(new Error("not found"))
    .mockResolvedValueOnce({
      progressId: "p",
      phase: "running",
      stages: [{ id: "fetch", status: "running" }],
    })
    .mockResolvedValueOnce({
      progressId: "p",
      phase: "done",
      stages: [{ id: "checkout", status: "running" }],
    });
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Probe, { id: "p" })));
  expect(view.error).toBe("not found");
  await act(async () => vi.advanceTimersByTimeAsync(400));
  expect(view.phase).toBe("running");
  await act(async () => vi.advanceTimersByTimeAsync(400));
  expect(view.phase).toBe("done");
  expect(view.stages.map((stage) => stage.status)).toEqual(["done", "done"]);
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(status).toHaveBeenCalledTimes(3);
  act(() => root.unmount());
});

it("does not poll without an id and stops on a missing capability", async () => {
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Probe, { id: null })));
  expect(status).not.toHaveBeenCalled();
  status.mockRejectedValue(new WorkspaceCapabilityError());
  await act(async () => root.render(createElement(Probe, { id: "q" })));
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(status).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
});

it("gives up after repeated failed polls and keeps the error", async () => {
  status.mockRejectedValue(new Error("not found"));
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Probe, { id: "gone" })));
  await act(async () => vi.advanceTimersByTimeAsync(120_000));
  expect(status).toHaveBeenCalledTimes(MAX_POLL_FAILURES);
  expect(view.error).toBe("not found");
  act(() => root.unmount());
});

it("keeps failed stages when finishing", () => {
  expect(
    finishedStages([
      { id: "fetch", status: "failed" },
      { id: "checkout", status: "pending" },
    ]).map((stage) => stage.status),
  ).toEqual(["failed", "done", "done"]);
});
