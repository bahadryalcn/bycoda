// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CrewTaskDialog } from "./CrewTaskDialog";

const h = vi.hoisted(() => ({
  saveTask: vi.fn(),
  startTask: vi.fn(),
  refetch: vi.fn(),
  data: {
    machine: { id: "m1", name: "Mac" },
    project: { id: "p1" },
    definitions: [],
    modelPoolsSupported: false,
  },
}));

vi.mock("../../tasks/public/taskCreation", () => ({
  newTaskDraft: (cwd: string) => ({ cwd, model: "", modelSettings: {} }),
  saveTask: h.saveTask,
  startTask: h.startTask,
  TaskForm: ({ onSubmit }: { onSubmit: (mode: string, draft: object) => void }) =>
    createElement(
      "button",
      { type: "button", onClick: () => onSubmit("queued", { cwd: "/repo", model: "" }) },
      "submit",
    ),
}));
vi.mock("../../connections/public/HostModelSource", () => ({
  HostModelSource: ({ children }: { children: unknown }) => children,
}));
vi.mock("./CrewMachineScope", () => ({
  useCrewMachineScope: (cwd: string) => ({
    cwd,
    state: { data: h.data, error: undefined, refetch: h.refetch },
  }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  h.refetch.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const task = { id: "t1", machineId: "m1", workspaceControlsSupported: true };
const text = () => document.body.textContent ?? "";
const button = (label: string) =>
  [...document.querySelectorAll("button")].find((entry) => entry.textContent === label);
const click = async (label: string) => {
  const target = button(label);
  expect(target).toBeDefined();
  await act(async () => {
    target!.click();
  });
};
const render = (onClose = vi.fn()) => {
  act(() => {
    root.render(createElement(CrewTaskDialog, { cwd: "/repo", state: {} as never, onClose }));
  });
  return onClose;
};

it("keeps the form and reports a creation failure without a success notice", async () => {
  h.saveTask.mockRejectedValue(new Error("offline"));
  const onClose = render();
  await click("submit");
  expect(button("submit")).toBeDefined();
  expect(text()).not.toContain("Task created");
  expect(h.startTask).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

it("keeps the created identity when the start fails and retries only the start", async () => {
  h.saveTask.mockResolvedValue(task);
  h.startTask.mockRejectedValueOnce(new Error("lost connection")).mockResolvedValueOnce(task);
  const onClose = render();
  await click("submit");
  expect(text()).toContain("could not be started");
  expect(button("submit")).toBeUndefined();
  expect(onClose).not.toHaveBeenCalled();

  await click("Retry");
  expect(h.saveTask).toHaveBeenCalledTimes(1);
  expect(h.startTask).toHaveBeenCalledTimes(2);
  expect(h.startTask.mock.calls[1][0]).toBe(task);
  expect(h.refetch).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("closes after a confirmed start even when the list refresh fails", async () => {
  h.saveTask.mockResolvedValue(task);
  h.startTask.mockResolvedValue(task);
  h.refetch.mockRejectedValue(new Error("refresh offline"));
  const onClose = render();
  await click("submit");
  expect(h.saveTask).toHaveBeenCalledTimes(1);
  expect(text()).not.toContain("could not be started");
  expect(onClose).toHaveBeenCalledTimes(1);
});
