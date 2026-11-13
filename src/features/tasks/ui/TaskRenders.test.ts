// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BoardTask, TaskDraft } from "../model/taskClient";
import type { TaskColumn } from "../model/hostTasks";
import { newTaskDraft } from "../model/taskClient";
import { TaskBoardColumns } from "./TaskBoardColumns";
import { TasksViewDraftDialog } from "./TasksViewDraftDialog";

const mocks = vi.hoisted(() => ({ cardRenders: 0 }));
vi.mock("../model/taskStatusLine", async (original) => {
  const actual = await original<typeof import("../model/taskStatusLine")>();
  return {
    ...actual,
    taskStatusLine: (...args: Parameters<typeof actual.taskStatusLine>) => {
      mocks.cardRenders++;
      return actual.taskStatusLine(...args);
    },
  };
});
vi.mock("./AssistantTaskBadge", () => ({ AssistantTaskBadge: () => null }));
vi.mock("../../connections/public/HostModelSource", () => ({
  HostModelSource: ({ children }: { children: unknown }) => children,
}));
vi.mock("./TaskForm", () => ({
  TaskForm: ({
    draft,
    onChange,
    onSubmit,
  }: {
    draft: TaskDraft;
    onChange: (next: TaskDraft) => void;
    onSubmit: (mode: "todo", draft: TaskDraft) => void;
  }) =>
    createElement("input", {
      "data-testid": "title",
      value: draft.title,
      onChange: (event: { target: { value: string } }) =>
        onChange({ ...draft, title: event.target.value }),
      onBlur: () => onSubmit("todo", draft),
    }),
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.cardRenders = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const task = {
  id: "1",
  projectId: "p",
  title: "Task",
  status: "todo",
  machineId: "m",
  machineName: "Workstation",
  harness: "claude",
  model: "sonnet",
  prompt: "do it",
  cwd: "/project",
  createdAt: 60_000,
  updatedAt: 60_000,
} as BoardTask;

const stable = {
  actionsFor: (() => ({})) as never,
  onOpen: () => {},
  onCompactColumnChange: () => {},
  taskContext: () => ({ project: "project", waitingFor: [] }),
  planningLabel: () => "",
  onTaskDrop: async () => {},
};

it("does not re-render an unchanged card when only the board clock moves", async () => {
  const props = (now: number) => ({
    tasks: [task],
    visibleTasks: [task],
    columns: new Map([["todo" as const, [task]]]),
    orders: new Map<string, string>(),
    compactColumn: "all" as const,
    now,
    acting: null,
    bulkBusy: false,
    selectedKey: null,
    openingSessions: new Set<string>(),
    empty: null,
    ...stable,
  });
  const columns = new Map<TaskColumn, BoardTask[]>(props(0).columns);
  for (const name of ["queued", "running", "review", "done", "blocked"] as const)
    columns.set(name, []);
  const render = (now: number) =>
    act(async () => root.render(createElement(TaskBoardColumns, { ...props(now), columns })));
  await render(6 * 60_000);
  const first = mocks.cardRenders;
  expect(first).toBeGreaterThan(0);
  await render(6 * 60_000 + 1000);
  expect(mocks.cardRenders).toBe(first);
});

it("keeps typing inside the draft dialog from re-rendering its owner", async () => {
  let ownerRenders = 0;
  const saved = vi.fn();
  const draft = newTaskDraft("/project", "claude", "model");
  function Owner() {
    ownerRenders++;
    const [seed] = useState(draft);
    return createElement(TasksViewDraftDialog, {
      draft: seed,
      recents: [],
      machines: [],
      todoCapable: [],
      saving: false,
      error: null,
      sprintName: undefined,
      onClose: () => {},
      onSave: saved,
    });
  }
  await act(async () => root.render(createElement(Owner)));
  const input = document.querySelector<HTMLInputElement>('[data-testid="title"]')!;
  const before = ownerRenders;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  for (const text of ["a", "ab", "abc"])
    await act(async () => {
      setValue.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  expect(ownerRenders).toBe(before);
  await act(async () => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  expect(saved).toHaveBeenCalledWith("todo", expect.objectContaining({ title: "abc" }));
});
