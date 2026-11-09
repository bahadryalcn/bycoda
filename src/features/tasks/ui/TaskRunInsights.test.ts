// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HostTask } from "../model/hostTasks";
import { TaskMetricsComparison, TaskRunInsights } from "./TaskRunInsights";

let root: Root;
let container: HTMLDivElement;
const task = (patch: Partial<HostTask> = {}): HostTask => ({
  id: "task",
  title: "Task",
  prompt: "Check this",
  projectId: "project",
  harness: "codex",
  model: "model",
  modelSettings: {},
  runtimeMode: "auto",
  maxRunMinutes: 0,
  status: "done",
  createdAt: 1,
  updatedAt: 2,
  ...patch,
});
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const field = (label: string) => {
  const found = [...container.querySelectorAll("label")].find((entry) =>
    entry.textContent?.includes(label),
  );
  return container.querySelector<HTMLInputElement>(`#${found?.htmlFor}`)!;
};
async function fill(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("shows unknown usage explicitly and never infers owner acceptance", async () => {
  const save = vi.fn(async () => {});
  await act(async () =>
    root.render(createElement(TaskRunInsights, { task: task(), onSaveEvaluation: save })),
  );
  expect(container.textContent).toContain("Unknown");
  expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
  expect(save).not.toHaveBeenCalled();
  expect(container.textContent).toContain("does not complete, approve or publish");
});

it("does not carry an unsaved acceptance decision into a new result", async () => {
  const save = vi.fn(async () => {});
  await act(async () =>
    root.render(
      createElement(TaskRunInsights, {
        task: task({ runId: "first", completedAt: 4 }),
        onSaveEvaluation: save,
      }),
    ),
  );
  await act(async () =>
    container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
  );
  expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
  await act(async () =>
    root.render(
      createElement(TaskRunInsights, {
        task: task({ runId: "second", status: "running" }),
        onSaveEvaluation: save,
      }),
    ),
  );
  expect(container.querySelector("form")).toBeNull();
  await act(async () =>
    root.render(
      createElement(TaskRunInsights, {
        task: task({ runId: "second", completedAt: 8 }),
        onSaveEvaluation: save,
      }),
    ),
  );
  expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
});

it("labels incomplete old run history as lower bounds instead of showing total usage", async () => {
  await act(async () =>
    root.render(
      createElement(TaskRunInsights, {
        task: task({
          budgetUsage: {
            historyComplete: false,
            agentMinutes: 0,
            attempts: 0,
            completedRuns: 0,
            runningRuns: 0,
            reportedTokens: 0,
            tokens: null,
            tokensComplete: false,
            unknownTokenRuns: 0,
            reportedCostUsd: null,
            estimatedCostUsd: null,
            measuredAt: 1,
          },
        }),
        onSaveEvaluation: vi.fn(async () => {}),
      }),
    ),
  );
  expect(container.textContent).toContain("Recorded readings are lower bounds");
  expect(container.querySelector("dd")?.textContent).toBe("Unknown");
});

it("saves explicit owner review data without modifying task state", async () => {
  const save = vi.fn(async () => {});
  const source = task();
  await act(async () =>
    root.render(createElement(TaskRunInsights, { task: source, onSaveEvaluation: save })),
  );
  await act(async () =>
    container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
  );
  await fill(field("My review time"), "2.5");
  await fill(field("Corrections I needed"), "3");
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(save).toHaveBeenCalledWith({ accepted: true, reviewMinutes: 2.5, corrections: 3 });
  expect(source.status).toBe("done");
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Evaluation saved");
});

it("prevents duplicate saves and preserves input when the save fails", async () => {
  let reject: (reason: Error) => void = () => {};
  const save = vi.fn(
    () =>
      new Promise<void>((_resolve, failure) => {
        reject = failure;
      }),
  );
  await act(async () =>
    root.render(createElement(TaskRunInsights, { task: task(), onSaveEvaluation: save })),
  );
  await fill(field("My review time"), "7");
  await act(async () => {
    const form = container.querySelector("form")!;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error("Try again")));
  expect(field("My review time").value).toBe("7");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Try again");
});

it("rejects empty or fractional correction drafts without saving", async () => {
  const save = vi.fn(async () => {});
  await act(async () =>
    root.render(createElement(TaskRunInsights, { task: task(), onSaveEvaluation: save })),
  );
  await fill(field("Corrections I needed"), "0.5");
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(save).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("valid review time");
});

it("compares only completed accepted results and labels incomplete billing", async () => {
  const accepted = task({
    evaluation: { accepted: true, reviewMinutes: 1, corrections: 0, recordedAt: 10 },
  });
  await act(async () =>
    root.render(
      createElement(TaskMetricsComparison, { tasks: [accepted, task({ id: "unrated" })] }),
    ),
  );
  expect(container.textContent).toContain("codex · model");
  expect(container.textContent).toContain("not a controlled model benchmark");
  expect(container.textContent).toContain("Partial readings are not shown as complete totals");
  expect(container.textContent).toContain("Unknown");
});
