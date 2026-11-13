import { QueryClient, QueryClientProvider, notifyManager } from "@tanstack/react-query";
import type { ReactNode } from "react";
// @vitest-environment happy-dom
import { act, createElement, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RemoteMachine } from "../../connections/public/protocol";
import type { ModelRoutingItemChoice } from "../../../shared/model/host-contracts/model-routing";
import { TaskModelChoiceField, useTaskModelRouting } from "./TaskModelChoiceField";
import { TaskModelChoiceLabel } from "./TaskModelChoiceLabel";
import { TaskForm } from "./TaskForm";
import { TaskFormAgent } from "./TaskFormAgent";
import { GoalForm } from "./GoalForm";
import { StewardForm } from "./TaskStewardForm";
import { newTaskDraft } from "../model/taskClient";
import { newGoalDraft } from "../model/goalClient";
import { newStewardDraft } from "../model/stewardClient";
import { defaultModelSettings, resolveModel } from "../../sessions/public/models";

const mocks = vi.hoisted(() => ({
  capabilities: vi.fn(),
  manage: vi.fn(),
  picker: vi.fn(),
  choice: vi.fn(),
}));
vi.mock("../../automations/model/machineSnapshot", () => ({
  machineCapabilities: mocks.capabilities,
}));
vi.mock("../../settings/public/modelsSettingsLink", () => ({ openModelsSettings: mocks.manage }));
vi.mock("../../model-routing/public/choice", () => ({
  ModelChoiceField: (props: { fixed: unknown }) => {
    mocks.choice(props);
    return props.fixed;
  },
  useModelRouting: () => ({ state: { pools: [{ id: "pool", name: "Night work" }] } }),
}));
vi.mock("../../sessions/public/ModelPicker", () => ({
  ModelPicker: (props: unknown) => {
    mocks.picker(props);
    return null;
  },
}));
vi.mock("../../sessions/public/AccessPicker", () => ({ AccessPicker: () => null }));
vi.mock("./TaskAccountPicker", () => ({ TaskAccountPicker: () => null }));
vi.mock("./TaskBudgetControls", () => ({ TaskBudgetControls: () => null }));
vi.mock("./TaskLimits", () => ({ MachineConcurrency: () => null }));
vi.mock("../../projects/public/SearchableProjectPicker", () => ({
  SearchableProjectPicker: () => null,
}));
vi.mock("./TaskWorkspacePicker", () => ({
  INITIAL_WORKSPACE_CHECKS: {},
  useWorkspaceChecks: () => [{}, vi.fn()],
  isWorkspaceValid: () => true,
  TaskWorkspacePicker: () => null,
}));
vi.mock("./useTaskTargetMachine", () => ({
  useTaskTargetMachine: () => ({
    targetId: "host",
    target: machine,
    machineOptions: [],
    projectState: { state: "ready", projects: [] },
    defaultAccountFor: () => undefined,
    projectChoices: () => [],
  }),
}));

vi.mock("../../automations/model/hostAutomationClient", () => ({
  backgroundMachineFor: () => machine,
}));

const machine: RemoteMachine = {
  id: "host",
  name: "Host",
  endpoint: "http://localhost",
  environmentId: "env",
};
let root: Root;
let client: QueryClient;
function render(node: ReactNode) {
  root.render(createElement(QueryClientProvider, { client }, node));
}
let container: HTMLDivElement;
beforeEach(() => {
  notifyManager.setScheduler((callback) => callback());
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.capabilities.mockReset().mockResolvedValue(["models.routing.v1"]);
  mocks.picker.mockClear();
  mocks.choice.mockClear();
  mocks.manage.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  client.clear();
  notifyManager.setScheduler((callback) => setTimeout(callback, 0));
  vi.unstubAllGlobals();
});

function Draft({
  existing = false,
  target = machine,
  initial,
}: {
  existing?: boolean;
  target?: RemoteMachine;
  initial?: ModelRoutingItemChoice;
}) {
  const [choice, setChoice] = useState(initial);
  const routing = useTaskModelRouting(target, !existing, choice);
  return createElement(TaskModelChoiceField, {
    routingRole: "task.worker",
    machine: target,
    supported: routing.supported,
    value: routing.choice,
    onChange: setChoice,
    fixed: createElement("span", null, "Fixed picker"),
  });
}

it("initializes a new draft from its target Host capability, preserves legacy edits", async () => {
  await act(async () => render(createElement(Draft)));
  expect(mocks.choice.mock.lastCall?.[0]).toMatchObject({
    value: { kind: "default" },
    allowDefault: true,
    machineId: "host",
    supported: true,
  });
  mocks.choice.mock.lastCall?.[0].onManage();
  expect(mocks.manage).toHaveBeenCalledWith("roles");
  await act(async () => render(createElement(Draft, { key: "edit", existing: true })));
  expect(mocks.choice.mock.lastCall?.[0].value).toBeUndefined();
});

it("keeps fixed-only behavior when capability is absent or probing fails", async () => {
  for (const failure of [false, true]) {
    if (failure) mocks.capabilities.mockRejectedValue(new Error("offline"));
    else mocks.capabilities.mockResolvedValue([]);
    await act(async () => render(createElement(Draft, { key: String(failure) })));
    expect(mocks.choice.mock.lastCall?.[0]).toMatchObject({ supported: false, value: undefined });
    expect(container.textContent).toContain("Fixed picker");
  }
});

it("submits a new steward with the derived role choice without changing parent state during render", async () => {
  const changed = vi.fn();
  const submit = vi.fn();
  await act(async () =>
    render(
      createElement(StewardForm, {
        draft: newStewardDraft("/project", "claude", "old"),
        recents: [],
        machine: "Host",
        target: machine,
        saving: false,
        error: null,
        onChange: changed,
        onCancel: vi.fn(),
        onSubmit: submit,
      }),
    ),
  );
  expect(changed).not.toHaveBeenCalled();
  expect(mocks.choice.mock.lastCall?.[0].value).toEqual({ kind: "default" });
  act(() =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(submit).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ modelChoice: { kind: "default" } }),
  );
});

it("does not apply a stale capability reply after the target changes", async () => {
  let reply!: (caps: string[]) => void;
  mocks.capabilities
    .mockReturnValueOnce(
      new Promise<string[]>((resolve) => {
        reply = resolve;
      }),
    )
    .mockResolvedValue([]);
  await act(async () => render(createElement(Draft)));
  await act(async () => render(createElement(Draft, { target: { ...machine, id: "old-host" } })));
  await act(async () => reply(["models.routing.v1"]));
  expect(mocks.choice.mock.lastCall?.[0]).toMatchObject({
    machineId: "old-host",
    supported: false,
    value: undefined,
  });
});

it.each(["task", "goal", "steward"])(
  "resets %s model settings when the model changes",
  async (kind) => {
    const changed = vi.fn();
    const settings = { stale: "old-model-option" };
    const common = {
      recents: [],
      saving: false,
      onCancel: () => {},
      onSubmit: () => {},
      machine: "Host",
      onChange: changed,
    };
    if (kind === "task") {
      await act(async () =>
        render(
          createElement(TaskFormAgent, {
            draft: { ...newTaskDraft("/project", "claude", "old"), modelSettings: settings },
            open: true,
            onOpenChange: () => {},
            update: () => {},
            onChange: changed,
            target: machine,
            routingSupported: true,
            projectName: "Project",
            hasProject: true,
            localAccounts: false,
            defaultAccountFor: () => undefined,
          }),
        ),
      );
    } else if (kind === "goal") {
      await act(async () =>
        render(
          createElement(GoalForm, {
            ...common,
            draft: {
              ...newGoalDraft("/project", "claude", "old"),
              modelChoice: { kind: "fixed" },
              modelSettings: settings,
            },
            machines: [machine],
            limits: [],
            onChangeLimits: () => {},
          }),
        ),
      );
    } else {
      await act(async () =>
        render(
          createElement(StewardForm, {
            ...common,
            draft: {
              ...newStewardDraft("/project", "claude", "old"),
              id: "existing",
              modelSettings: settings,
            },
            target: machine,
            error: null,
          }),
        ),
      );
    }
    const picker = mocks.picker.mock.calls[0][0] as ComponentProps<
      typeof import("../../sessions/public/ModelPicker").ModelPicker
    >;
    act(() => picker.onChange("claude", "old"));
    expect(changed.mock.lastCall?.[0].modelSettings).toEqual(settings);
    act(() => picker.onChange("codex", "gpt-5"));
    const next = changed.mock.lastCall?.[0];
    expect(next).toMatchObject({ harness: "codex", model: "gpt-5" });
    expect(next.modelSettings).not.toHaveProperty("stale");
    expect(next.modelSettings).toEqual(defaultModelSettings(resolveModel("codex", "gpt-5")));
  },
);

it.each<[ModelRoutingItemChoice | undefined, string]>([
  [undefined, "Fixed"],
  [{ kind: "fixed" }, "Fixed"],
  [{ kind: "default" }, "Default"],
  [{ kind: "order" }, "Model order"],
  [{ kind: "pool", poolId: "pool" }, "Night work"],
])("labels the choice beside the concrete model", async (choice, label) => {
  await act(async () => render(createElement(TaskModelChoiceLabel, { machineId: "host", choice })));
  expect(container.textContent).toBe(label);
});

it("submits a derived task choice without mutating the input draft or rendering parent updates", async () => {
  const changed = vi.fn();
  const submit = vi.fn();
  const draft = Object.freeze({
    ...newTaskDraft("/project", "claude", "old"),
    title: "Task",
    prompt: "Work",
  });
  await act(async () =>
    render(
      createElement(TaskForm, {
        draft,
        recents: [],
        machines: [machine],
        machine: "Host",
        saving: false,
        onChange: changed,
        onCancel: vi.fn(),
        onSubmit: submit,
      }),
    ),
  );
  expect(changed).not.toHaveBeenCalled();
  expect(draft.modelChoice).toBeUndefined();
  act(() =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(submit).toHaveBeenCalledWith(
    "todo",
    expect.objectContaining({ modelChoice: { kind: "default" } }),
  );
  expect(draft.modelChoice).toBeUndefined();
});
