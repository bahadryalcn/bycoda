// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskWorkflowControls } from "./TaskWorkflowControls";
import {
  loadTaskWorkflows,
  saveTaskWorkflows,
  BUILTIN_TASK_WORKFLOWS,
} from "../model/taskWorkflows";
import { readTaskInstructions } from "../model/taskInstructions";
import { evaluateTaskPreflight } from "../model/taskPreflight";

const scope = { machineId: "test-host", projectId: "test-project" };
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const button = (name: string) =>
  [...container.querySelectorAll("button")].find((entry) => entry.textContent?.trim() === name)!;
const nameInput = () => container.querySelector('input[maxlength="120"]') as HTMLInputElement;
async function typeName(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      nameInput(),
      value,
    );
    nameInput().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function render(props: Partial<Parameters<typeof TaskWorkflowControls>[0]> = {}) {
  const onApply = vi.fn();
  await act(async () =>
    root.render(
      createElement(TaskWorkflowControls, {
        scope,
        draft: { prompt: "Preserve this payment investigation" },
        onApply,
        ...props,
      }),
    ),
  );
  return onApply;
}

it("loads choices without applying anything, then explicitly applies while preserving the draft objective", async () => {
  const onApply = await render();
  expect(onApply).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Preparation not verified");
  await act(async () => button("Apply workflow").click());
  expect(onApply).toHaveBeenCalledTimes(1);
  expect(readTaskInstructions(onApply.mock.calls[0][0].prompt)?.objective).toBe(
    "Preserve this payment investigation",
  );
  expect(container.textContent).toContain("Workflow applied to this draft.");
});

it("saves, updates and removes a project workflow without executing or applying it", async () => {
  const onApply = await render();
  await typeName("Payment investigation");
  await act(async () => button("Save workflow").click());
  expect(loadTaskWorkflows(scope)).toHaveLength(1);
  expect(loadTaskWorkflows(scope)[0].draft.prompt).toBe("Preserve this payment investigation");
  expect(onApply).not.toHaveBeenCalled();
  await typeName("Updated investigation");
  await act(async () => button("Save workflow").click());
  expect(loadTaskWorkflows(scope)).toHaveLength(1);
  expect(loadTaskWorkflows(scope)[0].name).toBe("Updated investigation");
  await act(async () => button("Remove workflow").click());
  expect(loadTaskWorkflows(scope)).toEqual([]);
  expect(onApply).not.toHaveBeenCalled();
});

it("keeps concurrent profiles saved by another window", async () => {
  await render();
  saveTaskWorkflows(scope, [
    { ...BUILTIN_TASK_WORKFLOWS[0], id: "other", name: "Other window", createdAt: 1, updatedAt: 1 },
  ]);
  await typeName("This window");
  await act(async () => button("Save workflow").click());
  expect(loadTaskWorkflows(scope).map((entry) => entry.name)).toEqual([
    "Other window",
    "This window",
  ]);
});

it("increments saved workflow versions under a fixed clock and after a clock rollback", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
  const onApply = await render();
  await typeName("First revision");
  await act(async () => button("Save workflow").click());
  const first = loadTaskWorkflows(scope)[0];
  expect(first).toMatchObject({ createdAt: 1000, updatedAt: 1000 });
  await typeName("Same-clock revision");
  await act(async () => button("Save workflow").click());
  expect(loadTaskWorkflows(scope)[0]).toMatchObject({
    id: first.id,
    createdAt: 1000,
    updatedAt: 1001,
  });
  clock.mockReturnValue(900);
  await typeName("After clock rollback");
  await act(async () => button("Save workflow").click());
  expect(loadTaskWorkflows(scope)[0]).toMatchObject({
    id: first.id,
    createdAt: 1000,
    updatedAt: 1002,
  });
  await act(async () => button("Apply workflow").click());
  expect(onApply).toHaveBeenLastCalledWith(
    expect.any(Object),
    expect.objectContaining({ id: first.id, updatedAt: 1002 }),
  );
});

it("preserves another window's changes even when its stored timestamp is unchanged", async () => {
  vi.spyOn(Date, "now").mockReturnValue(1000);
  await render();
  await typeName("Original version");
  await act(async () => button("Save workflow").click());
  const original = loadTaskWorkflows(scope)[0];
  const concurrent = { ...original, name: "Another window's revision" };
  saveTaskWorkflows(scope, [concurrent]);
  await typeName("Stale local revision");
  await act(async () => button("Save workflow").click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "changed in another window",
  );
  expect(loadTaskWorkflows(scope)).toEqual([concurrent]);
  await act(async () => button("Remove workflow").click());
  expect(loadTaskWorkflows(scope)).toEqual([concurrent]);
});

it("refreshes a stale saved procedure without applying it or discarding the current request", async () => {
  vi.spyOn(Date, "now").mockReturnValue(1000);
  const requirements = [{ kind: "source" as const, id: "draft-source.md", required: true }];
  const draft = { prompt: "Keep this current payment investigation", requirements };
  const onApply = await render({ draft });
  await typeName("Saved payment procedure");
  await act(async () => button("Save workflow").click());
  const original = loadTaskWorkflows(scope)[0];
  const updated = {
    ...original,
    name: "Updated research procedure",
    updatedAt: 1001,
    draft: BUILTIN_TASK_WORKFLOWS[1].draft,
  };
  saveTaskWorkflows(scope, [updated]);
  await typeName("Keep my typed workflow name");
  await act(async () => button("Save workflow").click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "changed in another window",
  );
  await act(async () => button("Refresh workflows").click());
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector('[role="status"]')?.textContent).toContain("Workflows refreshed.");
  expect(nameInput().value).toBe("Keep my typed workflow name");
  expect(container.querySelector<HTMLInputElement>('input[maxlength="2000"]')?.value).toBe(
    "draft-source.md",
  );
  expect(onApply).not.toHaveBeenCalled();
  expect(loadTaskWorkflows(scope)).toEqual([updated]);
  await act(async () => button("Apply workflow").click());
  expect(readTaskInstructions(onApply.mock.calls[0][0].prompt)).toMatchObject({
    objective: draft.prompt,
    acceptance: [
      "Factual claims are checked against opened primary sources",
      "Missing evidence is explicitly marked unresolved",
    ],
  });
  expect(onApply.mock.calls[0][0].requirements).toEqual(requirements);
  expect(onApply.mock.calls[0][1]).toMatchObject({ id: original.id, updatedAt: 1001 });
});

it("resets a vanished saved selection on refresh while preserving the task draft", async () => {
  const onApply = await render();
  await typeName("Temporary procedure");
  await act(async () => button("Save workflow").click());
  saveTaskWorkflows(scope, []);
  await act(async () => button("Refresh workflows").click());
  expect(nameInput().value).toBe("");
  expect(button("Remove workflow")).toBeUndefined();
  expect(container.textContent).toContain("Bug fix");
  expect(onApply).not.toHaveBeenCalled();
});

it("does not save a new profile when the current clock is not finite", async () => {
  await render();
  await typeName("Invalid clock");
  vi.spyOn(Date, "now").mockReturnValue(NaN);
  await act(async () => button("Save workflow").click());
  expect(loadTaskWorkflows(scope)).toEqual([]);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("could not be updated");
});

it("changes resource requirements only through explicit edits", async () => {
  const onApply = await render();
  await act(async () => button("Add resource").click());
  expect(onApply).toHaveBeenCalledWith(
    expect.objectContaining({ requirements: [{ kind: "source", id: "", required: true }] }),
  );
  expect(loadTaskWorkflows(scope)).toEqual([]);
});

it("renders unknown runtime access without treating it as ready and prevents duplicate checks", async () => {
  let release: () => void = () => {};
  const onCheck = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const report = evaluateTaskPreflight([], {}, 100);
  await render({ preflight: report, onCheck });
  expect(container.textContent).toContain("Preparation not verified");
  expect(container.textContent).toContain("Not checked");
  await act(async () => button("Check preparation").click());
  expect(button("Check preparation").getAttribute("aria-busy")).toBe("true");
  expect(button("Apply workflow").getAttribute("aria-busy")).not.toBe("true");
  expect(button("Refresh workflows").getAttribute("aria-busy")).not.toBe("true");
  await act(async () => button("Check preparation").click());
  expect(onCheck).toHaveBeenCalledTimes(1);
  await act(async () => release());
});

it("preserves corrupt saved data and the parent draft", async () => {
  const key = `bycoda.task-workflows.v1:${JSON.stringify([scope.machineId, scope.projectId])}`;
  localStorage.setItem(key, "invalid saved data");
  const onApply = await render();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Existing saved data was preserved",
  );
  expect(localStorage.getItem(key)).toBe("invalid saved data");
  expect(onApply).not.toHaveBeenCalled();
});
