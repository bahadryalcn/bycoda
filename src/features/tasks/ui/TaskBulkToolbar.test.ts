// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskBulkToolbar } from "./TaskBulkToolbar";
import { bulkTaskKey } from "../model/taskBulkActions";
import type { BoardTask } from "../model/taskClient";

const { remove, confirm, start, move } = vi.hoisted(() => ({
  remove: vi.fn(),
  confirm: vi.fn(),
  start: vi.fn(),
  move: vi.fn(),
}));
vi.mock("../model/taskClient", () => ({
  deleteTask: remove,
  moveTask: move,
  startTask: start,
}));
vi.mock("../../../shared/ui/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm, dialog: null }),
}));

const task = (id: string, patch: Partial<BoardTask> = {}) =>
  ({
    id,
    projectId: "project",
    machineId: "pc",
    machineName: "PC",
    cwd: "/project",
    title: id,
    prompt: "Repair packaging",
    status: "done",
    createdAt: 1,
    updatedAt: 1,
    harness: "codex",
    model: "test",
    modelSettings: {},
    runtimeMode: "auto",
    maxRunMinutes: 0,
    ...patch,
  }) as BoardTask;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  confirm.mockResolvedValue(true);
  remove.mockReset();
  start.mockReset();
  move.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const button = (name: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => (node.getAttribute("aria-label") ?? node.textContent) === name,
  )!;
const disabled = (node: HTMLButtonElement) =>
  node.disabled || node.getAttribute("aria-disabled") === "true";
async function render(tasks: BoardTask[]) {
  const onSelect = vi.fn();
  const onDeleted = vi.fn();
  await act(async () =>
    root.render(
      createElement(TaskBulkToolbar, {
        tasks,
        selected: new Set(tasks.map(bulkTaskKey)),
        onSelect,
        onDeleted,
        onUpdated: vi.fn(),
        onBusy: vi.fn(),
        onFinish: vi.fn(),
        onError: vi.fn(),
      }),
    ),
  );
  return { onSelect, onDeleted };
}

it("offers valid crew transitions and disables actions that do not match the selected states", async () => {
  await render([
    task("crew-a", { crewRunId: "run", status: "todo" }),
    task("crew-b", { crewRunId: "run" }),
  ]);
  expect(disabled(button("Start"))).toBe(false);
  expect(disabled(button("Retry"))).toBe(true);
  expect(disabled(button("Delete"))).toBe(false);
  await act(async () => button("Stop").click());
  expect(confirm).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});

it("locks pending deletion, retains failures and retries only failed identities", async () => {
  const first = task("first"),
    second = task("second");
  let release!: () => void;
  remove
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    )
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce(undefined);
  const { onSelect, onDeleted } = await render([first, second]);
  await act(async () => button("Delete").click());
  expect(disabled(button("Delete"))).toBe(true);
  await act(async () => button("Delete").click());
  expect(remove).toHaveBeenCalledTimes(1);
  await act(async () => release());
  expect(container.textContent).toContain("1 succeeded, 0 skipped, 1 failed");
  expect(onDeleted).toHaveBeenCalledExactlyOnceWith(first);
  expect(onSelect).toHaveBeenLastCalledWith(new Set([bulkTaskKey(second)]));
  await act(async () => button("Retry failed tasks").click());
  expect(remove).toHaveBeenCalledTimes(3);
  expect(remove.mock.calls.map(([row]) => row.id)).toEqual(["first", "second", "second"]);
  await act(async () => button("Clear selection").click());
  expect(container.textContent).not.toContain("succeeded");
});

it("disables deletion before confirmation when all selected work is protected", async () => {
  await render([
    task("active", { status: "running" }),
    task("review", { branch: "mc/review", status: "review", merged: false }),
  ]);
  expect(disabled(button("Delete"))).toBe(true);
  await act(async () => button("Delete").click());
  expect(confirm).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});

it.each([true, false])(
  "retries through the same admission path as individual tasks, modern Host %s",
  async (modern) => {
    const row = task("retry", {
      status: "blocked",
      crewRunId: "run",
      workspaceControlsSupported: modern,
    });
    start.mockResolvedValue({ ...row, status: "queued" });
    move.mockResolvedValue({ ...row, status: "queued" });
    await render([row]);
    await act(async () => button("Retry").click());
    if (modern) {
      expect(start).toHaveBeenCalledExactlyOnceWith(row);
      expect(move).not.toHaveBeenCalled();
    } else {
      expect(move).toHaveBeenCalledExactlyOnceWith(row, "queued");
      expect(start).not.toHaveBeenCalled();
    }
  },
);
