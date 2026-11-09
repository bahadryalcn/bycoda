// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { AssistantProfilePatch } from "../../../../shared/model/host-contracts/assistant";
const observed = vi.hoisted(() => ({
  patches: [] as AssistantProfilePatch[],
  resolvedDefault: "catalog-default",
  defaultAvailable: true,
}));
vi.mock("../../../settings/public/settingsControls", async () => {
  const { createElement } = await import("react");
  return {
    Row: ({ label, description, info, children }: any) =>
      createElement(
        "div",
        { role: "group", "aria-label": label },
        createElement("span", null, label),
        description ? createElement("p", null, description) : null,
        info,
        children,
      ),
    Group: ({ title, info, action, children }: any) =>
      createElement("section", null, createElement("h2", null, title), info, action, children),
    AdvancedSettings: ({ title, children }: any) =>
      createElement("div", null, createElement("button", { type: "button" }, title), children),
  };
});
vi.mock("../../../../shared/i18n", () => ({
  t: (key: string, values: Record<string, unknown> = {}) =>
    key.replace(/\{(p\d+)\}/g, (_, name) => String(values[name] ?? `{${name}}`)),
  useT: () => (key: string) => key,
}));
vi.mock("../../../sessions/ui/modelSource", () => ({
  useModelSource: () => ({
    resolve: (harness: string, model: string) => ({
      harness,
      id: model || observed.resolvedDefault,
      settings: [{ id: "effort", value: "default" }],
    }),
    available: () => observed.defaultAvailable,
    modelsFor: (harness: string) =>
      observed.defaultAvailable ? [{ harness, id: observed.resolvedDefault }] : [],
  }),
}));
vi.mock("../../../sessions/model/models", () => ({
  resolveModel: (harness: string, model: string) => ({ harness, id: model }),
  defaultModelSettings: (model: { settings?: { id: string; value: string }[] }) =>
    model.settings
      ? Object.fromEntries(model.settings.map((setting) => [setting.id, setting.value]))
      : { effort: "default" },
}));
vi.mock("../../../sessions/ui/ModelPicker", () => ({
  ModelPicker: (props: any) =>
    createElement(
      "div",
      null,
      createElement(
        "button",
        {
          type: "button",
          onClick: () => props.onChange("claude", "selected-model"),
        },
        props.model || "Choose model",
      ),
      createElement(
        "button",
        {
          type: "button",
          onClick: () => props.onSettingsChange({ ...props.values, effort: "low" }),
        },
        "Adjust effort",
      ),
    ),
}));
import { AssistantWorkFields } from "./AssistantWorkFields";

let root: Root | undefined, container: HTMLDivElement;
const execution = {
  harness: "codex" as const,
  model: "owner-worker",
  modelSettings: { effort: "high", custom: "retained" },
  runtimeMode: "supervised" as const,
  maxRunMinutes: 45,
};

async function setup(initial: AssistantProfilePatch) {
  observed.patches = [];
  observed.resolvedDefault = "catalog-default";
  observed.defaultAvailable = true;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  function Form() {
    const [value, setValue] = useState(initial);
    return createElement(AssistantWorkFields, {
      value,
      onChange: (patch: AssistantProfilePatch) => {
        observed.patches.push(patch);
        setValue((current) => ({ ...current, ...patch }));
      },
    });
  }
  await act(async () => root!.render(createElement(Form)));
}

/** The model row whose label is the legend, e.g. "Supervisor". */
function group(label: string) {
  return [...container.querySelectorAll("fieldset")].find(
    (element) => element.querySelector("legend")?.textContent === label,
  )!;
}

async function click(text: string, scope: ParentNode = container) {
  const target = [...scope.querySelectorAll("button")].find(
    (button) => button.textContent === text || button.getAttribute("aria-label") === text,
  );
  expect(target).toBeTruthy();
  await act(async () => target!.click());
}

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  vi.unstubAllGlobals();
});

it("shows the Models group always, with four labelled choices and no advanced toggle", async () => {
  await setup({ execution, chiefExecution: null, replyExecution: null, planningExecution: null });
  expect(container.textContent).toContain("Models");
  expect(container.textContent).not.toContain("Advanced role models");
  for (const label of ["Workers", "Supervisor", "Replies", "Planner"]) {
    expect(group(label)).toBeTruthy();
  }
  expect(group("Workers").textContent).not.toContain("Same as workers");
  for (const label of ["Supervisor", "Replies", "Planner"]) {
    expect(group(label).textContent).toContain("Same as workers");
  }
  expect(observed.patches).toEqual([]);
});

it("keeps inherited roles on the worker model until the owner overrides one", async () => {
  await setup({ execution });
  expect(group("Supervisor").textContent).toContain("owner-worker");
  expect(group("Supervisor").querySelector("[aria-label='Use same as workers']")).toBeNull();

  await click("owner-worker", group("Supervisor"));
  expect(observed.patches.at(-1)).toEqual({
    chiefExecution: {
      ...execution,
      harness: "claude",
      model: "selected-model",
      modelSettings: { effort: "default" },
    },
  });
  expect(execution.modelSettings.effort).toBe("high");
});

it("changes only the selected role and never the worker or other roles", async () => {
  await setup({ execution });
  await click("owner-worker", group("Planner"));
  expect(
    observed.patches.every(
      (patch) =>
        !Object.hasOwn(patch, "execution") &&
        !Object.hasOwn(patch, "chiefExecution") &&
        !Object.hasOwn(patch, "replyExecution"),
    ),
  ).toBe(true);
  expect(Object.keys(observed.patches.at(-1)!)).toEqual(["planningExecution"]);
});

it("reset (x) on an overriding role returns it to the worker model", async () => {
  const reply = { ...execution, harness: "claude" as const, model: "saved-reply" };
  await setup({ execution, replyExecution: reply });
  expect(group("Replies").textContent).toContain("saved-reply");
  expect(group("Replies").textContent).not.toContain("Same as workers");

  await click("Use same as workers", group("Replies"));
  expect(observed.patches.at(-1)).toEqual({ replyExecution: null });
});

it("editing an inherited role's effort clones the worker settings into that role only", async () => {
  await setup({ execution });
  await click("Adjust effort", group("Planner"));
  expect(observed.patches.at(-1)).toEqual({
    planningExecution: {
      ...execution,
      modelSettings: { effort: "low", custom: "retained" },
    },
  });
  expect(execution.modelSettings.effort).toBe("high");
});

it("an unset worker model lets an optional role be created from the resolved source", async () => {
  await setup({ execution: null, replyExecution: null });
  expect(observed.patches).toEqual([]);
  await click("Adjust effort", group("Replies"));
  expect(observed.patches).toEqual([
    {
      replyExecution: {
        harness: "codex",
        model: "catalog-default",
        modelSettings: { effort: "low" },
        runtimeMode: "supervised",
        maxRunMinutes: 60,
      },
    },
  ]);
});

it("changing the worker model updates the worker row only", async () => {
  await setup({ execution });
  await click("owner-worker", group("Workers"));
  expect(observed.patches.at(-1)).toEqual({
    execution: {
      ...execution,
      harness: "claude",
      model: "selected-model",
      modelSettings: { effort: "default" },
    },
  });
});

it("shows one short hint for each work control", async () => {
  await setup({ execution, autonomy: "jobs", allowRoutineQuestions: false });
  expect(container.textContent).toContain("Report only observes; the other modes start work.");
  expect(container.textContent).toContain("Big jobs: four or more tasks or several projects.");
  expect(container.textContent).toContain("Off starts assigned jobs immediately.");
  expect(container.textContent).toContain(
    "Never approves permissions, publishing, credentials or destructive actions.",
  );
  expect(container.textContent).toContain("Execution permissions");
  expect(container.textContent).toContain("Does the job's work.");
  expect(container.textContent).toContain("Reviews progress.");
  expect(container.textContent).toContain("Answers you in chat.");
  expect(container.textContent).toContain("Splits big jobs into tasks.");
});

it("clears a failed model setting error after an explicit valid choice", async () => {
  await setup({ execution: null });
  observed.defaultAvailable = false;
  await click("Adjust effort", group("Replies"));
  expect(container.querySelector('[role="alert"]')).toBeTruthy();
  expect(observed.patches).toEqual([]);
  await click("Choose model", group("Replies"));
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(observed.patches.at(-1)?.replyExecution?.model).toBe("selected-model");
});
