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
import { AssistantWorkFields } from "./AssistantWorkFields";

let root: Root | undefined, container: HTMLDivElement;
const execution = {
  harness: "codex" as const,
  model: "owner-worker",
  modelSettings: { effort: "high", custom: "retained" },
  runtimeMode: "supervised" as const,
  maxRunMinutes: 45,
};

async function setup(
  initial: AssistantProfilePatch,
  part: "jobs" | "budget" | "permissions" = "jobs",
) {
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
      part,
      value,
      onChange: (patch: AssistantProfilePatch) => {
        observed.patches.push(patch);
        setValue((current) => ({ ...current, ...patch }));
      },
    });
  }
  await act(async () => root!.render(createElement(Form)));
}

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  vi.unstubAllGlobals();
});

it("shows one short hint for each job control and no model rows", async () => {
  await setup({ execution, autonomy: "jobs", allowRoutineQuestions: false });
  expect(container.textContent).toContain("Report only observes; the other modes start work.");
  expect(container.textContent).toContain("Big jobs: four or more tasks or several projects.");
  expect(container.textContent).toContain("Off starts assigned jobs immediately.");
  expect(container.textContent).toContain(
    "Never approves permissions, publishing, credentials or destructive actions.",
  );
  expect(container.textContent).not.toContain("Execution permissions");
  expect(container.querySelector("fieldset")).toBeNull();
  expect(observed.patches).toEqual([]);
});

it("renders the daily token budget and the permission picker as their own parts", async () => {
  await setup({ execution, dailyTokenBudget: 500_000 }, "budget");
  expect(container.textContent).toContain("Daily token budget");
  expect(container.textContent).not.toContain("Autonomy");
  await act(async () => root!.unmount());
  container.remove();
  await setup({ execution }, "permissions");
  expect(container.textContent).toContain("Execution permissions");
  expect(container.textContent).not.toContain("Autonomy");
});

it("renders no permission picker until a worker execution exists", async () => {
  await setup({ execution: null }, "permissions");
  expect(container.textContent).toBe("");
});
