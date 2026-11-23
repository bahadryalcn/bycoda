// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskList } from "./TaskList";
import type { TaskActionHandlers } from "./TaskCardActions";
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

const base = {
  prompt: "Do it",
  machineId: "a",
  machineName: "Workstation",
  cwd: "/project",
} as const;

const draw = (tasks: BoardTask[], extra: Record<string, unknown> = {}) =>
  act(async () =>
    root.render(
      createElement(TaskList, {
        tasks,
        selection: false,
        selected: new Set<string>(),
        onOpen: vi.fn(),
        onToggle: vi.fn(),
        ...extra,
      }),
    ),
  );

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
    scroller.scrollTop = 26600;
    scroller.dispatchEvent(new Event("scroll"));
  });
  expect(container.textContent).toContain("Task 500");
  await render(900);
  await render(1000);
  expect(scroller.scrollTop).toBe(26600);
  expect(container.querySelectorAll(".task-management-row").length).toBeLessThan(64);
  expect(container.textContent).not.toContain("Previous");
  expect(container.textContent).not.toContain("Next");
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
  await draw([task]);
  expect(container.textContent).toContain("Repair standalone packaging");
  expect(container.textContent).not.toContain("Responsibilities");
  expect(container.textContent).not.toContain("Workstation");
});

it("shows a failure's reason on the row and names machines only when several are listed", async () => {
  const failed = {
    ...base,
    id: "failed-task",
    title: "Ship the report",
    status: "blocked",
    error: "Checks failed: 2 tests. See the log.",
  } as BoardTask;
  const other = { ...failed, id: "other", error: undefined, machineId: "b", machineName: "Laptop" };
  await draw([failed]);
  expect(container.textContent).toContain("Checks failed: 2 tests.");
  expect(container.textContent).not.toContain("Workstation");
  await draw([failed, other]);
  expect(container.textContent).toContain("Workstation");
  expect(container.textContent).toContain("Laptop");
});

it("sections tasks by state with a count, keeps queued in To do and retries from a blocked row", async () => {
  const todo = { ...base, id: "todo", title: "Fine task", status: "todo" } as BoardTask;
  const queued = { ...base, id: "queued", title: "Waiting task", status: "queued" } as BoardTask;
  const blocked = {
    ...base,
    id: "blocked",
    title: "Broken task",
    status: "blocked",
    error: "Checks failed.",
  } as BoardTask;
  const onRetry = vi.fn();
  await draw([todo, queued, blocked], { onRetry });
  const rows = [...container.querySelectorAll(".task-management-row")];
  // Blocked leads, then To do with queued inside it, each section in its own state order.
  expect(rows.map((row) => row.textContent)).toEqual([
    expect.stringContaining("Broken task"),
    expect.stringContaining("Fine task"),
    expect.stringContaining("Waiting task"),
  ]);
  const headings = [...container.querySelectorAll("[data-task-group]")];
  expect(headings.map((heading) => heading.getAttribute("data-task-group"))).toEqual([
    "blocked",
    "todo",
  ]);
  expect(headings[0].textContent).toContain("Blocked");
  expect(headings[0].textContent).toContain("1");
  expect(headings[1].textContent).toContain("To do");
  expect(headings[1].textContent).toContain("2");
  // Queued keeps its own label inside the To do section; a plain todo row names no state.
  expect(rows[2].textContent).toContain("Queued");
  expect(rows[1].textContent).not.toContain("To do");
  const retry = [...rows[0].querySelectorAll("button")].find((b) => b.textContent === "Retry")!;
  await act(async () => retry.click());
  expect(onRetry).toHaveBeenCalledWith(blocked);
});

it("offers one lead action per row and moves the rest into the overflow", async () => {
  const todo = { ...base, id: "todo", title: "Fine task", status: "todo" } as BoardTask;
  const onMove = vi.fn();
  const handlers = {
    busy: false,
    onStart: vi.fn(),
    onDelivery: vi.fn(),
    onPauseMerge: vi.fn(),
    onMove,
    onReviewWorkspace: async () => {},
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onDecline: vi.fn(),
    openingWorkerSession: false,
    openingReviewSession: false,
    isOpeningSession: () => false,
    onReadNotes: vi.fn(),
    onResolveNote: vi.fn(),
    onOpenReview: vi.fn(),
    onRecheckReview: vi.fn(),
  } satisfies TaskActionHandlers;
  await draw([todo], { actionsFor: () => handlers });
  const row = container.querySelector(".task-management-row")!;
  const names = [...row.querySelectorAll("button")].map(
    (button) => button.getAttribute("aria-label") ?? button.textContent,
  );
  expect(names).toContain("Start");
  expect(names).toContain("More actions");
  expect(names).not.toContain("Delete");
  const start = [...row.querySelectorAll("button")].find((b) => b.textContent === "Start")!;
  await act(async () => start.click());
  expect(onMove).toHaveBeenCalledWith("queued");
});
