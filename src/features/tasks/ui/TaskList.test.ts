// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskList, taskListDescription, taskListUpdatedAt } from "./TaskList";
import type { BoardTask } from "../model/taskClient";
import { bulkTaskKey } from "../model/taskBulkActions";
vi.mock("./AssistantTaskBadge", () => ({ AssistantTaskBadge: () => null }));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(480);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(80);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps bulk selection and active task through bounded scroll and appended rows", async () => {
  const tasks = Array.from({ length: 1000 }, (_, index) => ({
    id: String(index),
    projectId: "project",
    title: `Task ${index}`,
    status: "todo",
    machineId: "machine",
    machineName: "Workstation",
    cwd: "/project",
  })) as BoardTask[];
  const selected = new Set(tasks.map(bulkTaskKey));
  const onOpen = vi.fn();
  const onToggle = vi.fn();
  const render = (count: number) =>
    act(async () =>
      root.render(
        createElement(TaskList, {
          tasks: tasks.slice(0, count),
          selection: true,
          selected,
          activeKey: "machine:999",
          onOpen,
          onToggle,
        }),
      ),
    );
  await render(1000);
  expect(container.querySelectorAll(".task-management-row").length).toBeLessThan(64);
  expect(container.querySelector("[data-active]")?.textContent).toContain("Task 999");
  expect(
    [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every(
      (node) => node.checked,
    ),
  ).toBe(true);
  const scroller = container.querySelector<HTMLElement>("[data-continuous-list]")!;
  await act(async () => {
    scroller.scrollTop = 19000;
    scroller.dispatchEvent(new Event("scroll"));
  });
  expect(container.textContent).toContain("Task 500");
  await render(900);
  await render(1000);
  expect(scroller.scrollTop).toBe(19000);
  expect(container.querySelectorAll(".task-management-row").length).toBeLessThan(64);
  expect(container.textContent).not.toContain("Previous");
  expect(container.textContent).not.toContain("Next");
});

it("derives a one-line description and ignores missing or invalid update times", () => {
  expect(taskListDescription("\n  ## Fix login\nmore")).toBe("Fix login");
  expect(taskListDescription(undefined)).toBe("");
  expect(taskListDescription("Responsibilities\nMaintain builds", true)).toBe("");
  const brief = JSON.stringify({
    schema: "bycoda.task.v1",
    objective: "Preserve drafts\nacross restarts",
    deliverables: ["Draft store"],
    acceptance: ["Drafts survive"],
    constraints: [],
    verification: [],
  });
  expect(taskListDescription(brief)).toBe("Preserve drafts");
  expect(taskListDescription(brief, true)).toBe("Preserve drafts");
  expect(taskListUpdatedAt({ updatedAt: 0 })).toBeNull();
  expect(taskListUpdatedAt({ updatedAt: Number.NaN })).toBeNull();
  expect(taskListUpdatedAt({ updatedAt: 1_700_000_000_000 })).toBe(1_700_000_000_000);
});

it("shows the assignment title without repeating crew role instructions", async () => {
  const task = {
    id: "crew-task",
    projectId: "project",
    title: "Repair standalone packaging",
    prompt: "Responsibilities\nMaintain builds and CI.",
    crewRunId: "crew-run",
    status: "todo",
    machineId: "machine",
    machineName: "Workstation",
    cwd: "/project",
  } as BoardTask;
  await act(async () =>
    root.render(
      createElement(TaskList, {
        tasks: [task],
        selection: false,
        selected: new Set<string>(),
        onOpen: vi.fn(),
        onToggle: vi.fn(),
      }),
    ),
  );
  expect(container.textContent).toContain("Repair standalone packaging");
  expect(container.textContent).not.toContain("Responsibilities");
  expect(container.textContent).not.toContain("Workstation");
});

it("shows a failure's reason on the row and names machines only when several are listed", async () => {
  const failed = {
    id: "failed-task",
    title: "Ship the report",
    prompt: "Ship it",
    status: "blocked",
    error: "Checks failed: 2 tests. See the log.",
    machineId: "a",
    machineName: "Workstation",
    cwd: "/project",
  } as BoardTask;
  const other = { ...failed, id: "other", error: undefined, machineId: "b", machineName: "Laptop" };
  const draw = (tasks: BoardTask[]) =>
    act(async () =>
      root.render(
        createElement(TaskList, {
          tasks,
          selection: false,
          selected: new Set<string>(),
          onOpen: vi.fn(),
          onToggle: vi.fn(),
        }),
      ),
    );
  await draw([failed]);
  expect(container.textContent).toContain("Checks failed: 2 tests.");
  expect(container.textContent).not.toContain("Workstation");
  await draw([failed, other]);
  expect(container.textContent).toContain("Workstation");
  expect(container.textContent).toContain("Laptop");
});

it("groups failures first under one heading and retries a failed task from its row", async () => {
  const base = {
    prompt: "Do it",
    machineId: "a",
    machineName: "Workstation",
    cwd: "/project",
  } as const;
  const fine = { ...base, id: "fine", title: "Fine task", status: "todo" } as BoardTask;
  const failed = {
    ...base,
    id: "failed",
    title: "Broken task",
    status: "blocked",
    error: "Checks failed.",
  } as BoardTask;
  const onRetry = vi.fn();
  await act(async () =>
    root.render(
      createElement(TaskList, {
        tasks: [fine, failed],
        selection: false,
        selected: new Set<string>(),
        onOpen: vi.fn(),
        onToggle: vi.fn(),
        onRetry,
      }),
    ),
  );
  const rows = [...container.querySelectorAll(".task-management-row")];
  expect(rows[0].textContent).toContain("Broken task");
  expect(rows[1].textContent).toContain("Fine task");
  expect(container.querySelector('[data-task-group="failed"]')?.textContent).toBe("Failed · 1");
  expect(container.querySelector('[data-task-group="other"]')?.textContent).toBe("Other · 1");
  const retry = [...rows[0].querySelectorAll("button")].find((b) => b.textContent === "Retry")!;
  await act(async () => retry.click());
  expect(onRetry).toHaveBeenCalledWith(failed);
});
