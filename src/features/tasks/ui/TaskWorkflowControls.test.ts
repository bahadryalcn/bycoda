// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskResourceFields, TaskTemplateMenu } from "./TaskWorkflowControls";
import {
  BUILTIN_TASK_WORKFLOWS,
  loadTaskWorkflows,
  saveTaskWorkflows,
} from "../model/taskWorkflows";
import { readTaskInstructions } from "../model/taskInstructions";
import { evaluateTaskPreflight } from "../model/taskPreflight";

const scope = { machineId: "test-host", projectId: "test-project" };
const objective = "Preserve this payment investigation";
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
  [...document.querySelectorAll("button")].find((entry) => entry.textContent?.trim() === name);
const click = async (name: string) => act(async () => button(name)!.click());
const nameInput = () => document.querySelector<HTMLInputElement>('input[maxlength="120"]')!;
async function typeName(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      nameInput(),
      value,
    );
    nameInput().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function render() {
  const onApply = vi.fn();
  function TestMenu() {
    const [templateId, setTemplateId] = useState<string>();
    return createElement(TaskTemplateMenu, {
      scope,
      busy: false,
      draft: { prompt: objective },
      templateId,
      onApply(draft, profile) {
        setTemplateId(profile.id);
        onApply(draft, profile);
      },
    });
  }
  await act(async () => root.render(createElement(TestMenu)));
  return onApply;
}

it("applies a selected template immediately and preserves the draft objective", async () => {
  const onApply = await render();
  await click("Template");
  expect(onApply).not.toHaveBeenCalled();
  await click("Bug fix");
  expect(onApply).toHaveBeenCalledTimes(1);
  expect(readTaskInstructions(onApply.mock.calls[0][0].prompt)?.objective).toBe(objective);
  expect(button("Template: Bug fix")).toBeDefined();
});

it("loads saved templates every time the menu opens without applying them", async () => {
  const onApply = await render();
  await click("Template");
  await click("Template");
  saveTaskWorkflows(scope, [
    { ...BUILTIN_TASK_WORKFLOWS[0], id: "other", name: "Other window", createdAt: 1, updatedAt: 1 },
  ]);
  await click("Template");
  expect(button("Other window")).toBeDefined();
  expect(onApply).not.toHaveBeenCalled();
});

it("saves, versions and removes a template from the menu", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
  await render();
  await click("Template");
  await click("Save as template");
  await typeName("First revision");
  await click("Save");
  const first = loadTaskWorkflows(scope)[0];
  expect(first).toMatchObject({ createdAt: 1000, updatedAt: 1000, draft: { prompt: objective } });
  await click("Save as template");
  await typeName("Same-clock revision");
  await click("Save");
  expect(loadTaskWorkflows(scope)[0]).toMatchObject({ id: first.id, updatedAt: 1001 });
  clock.mockReturnValue(900);
  await click("Save as template");
  await typeName("After clock rollback");
  await click("Save");
  expect(loadTaskWorkflows(scope)[0]).toMatchObject({ id: first.id, updatedAt: 1002 });
  await click("Remove template");
  expect(loadTaskWorkflows(scope)).toEqual([]);
});

it("preserves concurrent edits and the typed template name on reopen", async () => {
  await render();
  await click("Template");
  await click("Save as template");
  await typeName("Original");
  await click("Save");
  const original = loadTaskWorkflows(scope)[0];
  const concurrent = { ...original, name: "Another window's revision" };
  saveTaskWorkflows(scope, [concurrent]);
  await click("Save as template");
  await typeName("Keep this name");
  await click("Save");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "The template could not be updated.",
  );
  await click("Details");
  expect(document.body.textContent).toContain("changed in another window");
  await click("Remove template");
  expect(loadTaskWorkflows(scope)).toEqual([concurrent]);
  await click("Template: Original");
  await click("Template: Original");
  await click("Save as template");
  expect(nameInput().value).toBe("Keep this name");
});

it("preserves corrupt saved data and the current draft", async () => {
  const key = `bycoda.task-workflows.v1:${JSON.stringify([scope.machineId, scope.projectId])}`;
  localStorage.setItem(key, "invalid saved data");
  const onApply = await render();
  await click("Template");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "The template could not be updated.",
  );
  await click("Details");
  expect(document.body.textContent).toContain("Existing saved data was preserved");
  expect(localStorage.getItem(key)).toBe("invalid saved data");
  expect(onApply).not.toHaveBeenCalled();
});

it("renders one preparation status and edits resources independently of templates", async () => {
  const onChange = vi.fn();
  const report = evaluateTaskPreflight([], {}, 100);
  await act(async () =>
    root.render(
      createElement(TaskResourceFields, { requirements: [], onChange, preparation: { report } }),
    ),
  );
  expect(container.textContent).toContain("Preparation not verified");
  expect(container.textContent).toContain("Not checked");
  expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  await click("Add");
  expect(onChange).toHaveBeenCalledWith([{ kind: "source", id: "", required: true }]);
  expect(loadTaskWorkflows(scope)).toEqual([]);
});
