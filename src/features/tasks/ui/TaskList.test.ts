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
    scroller.scrollTop = 36000;
    scroller.dispatchEvent(new Event("scroll"));
  });
  expect(container.textContent).toContain("Task 500");
  await render(900);
  await render(1000);
  expect(scroller.scrollTop).toBe(36000);
  expect(container.querySelectorAll(".task-management-row").length).toBeLessThan(64);
  expect(container.textContent).not.toContain("Previous");
  expect(container.textContent).not.toContain("Next");
});

it("derives a one-line description and ignores missing or invalid update times", () => {
  expect(taskListDescription("\n  ## Fix login\nmore")).toBe("Fix login");
  expect(taskListDescription(undefined)).toBe("");
  const brief = JSON.stringify({
    schema: "bycoda.task.v1",
    objective: "Preserve drafts\nacross restarts",
    deliverables: ["Draft store"],
    acceptance: ["Drafts survive"],
    constraints: [],
    verification: [],
  });
  expect(taskListDescription(brief)).toBe("Preserve drafts");
  expect(taskListUpdatedAt({ updatedAt: 0 })).toBeNull();
  expect(taskListUpdatedAt({ updatedAt: Number.NaN })).toBeNull();
  expect(taskListUpdatedAt({ updatedAt: 1_700_000_000_000 })).toBe(1_700_000_000_000);
});
