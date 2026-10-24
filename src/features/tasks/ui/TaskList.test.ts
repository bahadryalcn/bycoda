// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskList } from "./TaskList";
import { bulkTaskKey } from "../model/taskBulkActions";
import type { BoardTask } from "../model/taskClient";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const tasks = Array.from({ length: 5_000 }, (_, index) => ({
  id: `task-${index}`,
  title: `Task ${index}`,
  machineId: "local",
  machineName: "Local",
  cwd: "/project",
  status: "todo",
})) as BoardTask[];

it("bounds mounted rows while retaining full selection, paging, position and open identity", () => {
  const selected = new Set(tasks.map(bulkTaskKey));
  const open = vi.fn();
  const toggle = vi.fn();
  act(() =>
    root.render(
      createElement(TaskList, { tasks, selected, selection: true, onOpen: open, onToggle: toggle }),
    ),
  );
  expect(host.querySelectorAll("li")).toHaveLength(50);
  expect(host.querySelector("li")?.getAttribute("aria-setsize")).toBe("5000");
  expect(host.querySelectorAll("input:checked")).toHaveLength(50);
  const next = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Next",
  )!;
  act(() => next.click());
  expect(host.querySelectorAll("li")).toHaveLength(50);
  expect(host.querySelector("li")?.getAttribute("aria-posinset")).toBe("51");
  const item = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Task 50",
  )!;
  act(() => item.click());
  expect(open).toHaveBeenCalledWith(tasks[50]);
  const checkbox = host.querySelector<HTMLInputElement>("input")!;
  act(() => checkbox.click());
  expect(toggle).toHaveBeenCalledWith(tasks[50], false);
  expect(selected.size).toBe(5_000);
});

it("keeps small filtered results available when the previous page becomes invalid", () => {
  const props = {
    selected: new Set<string>(),
    selection: false,
    onOpen: vi.fn(),
    onToggle: vi.fn(),
  };
  act(() => root.render(createElement(TaskList, { ...props, tasks })));
  act(() =>
    [...host.querySelectorAll("button")].find((button) => button.textContent === "Next")!.click(),
  );
  act(() => root.render(createElement(TaskList, { ...props, tasks: tasks.slice(0, 2) })));
  expect(host.querySelectorAll("li")).toHaveLength(2);
  expect(host.querySelector("nav")).toBeNull();
  expect(host.textContent).toContain("Task 0");
});
