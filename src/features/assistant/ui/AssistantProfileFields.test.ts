// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { AssistantProfilePatch } from "../../../shared/model/host-contracts/assistant";
const observed = vi.hoisted(() => ({
  patches: [] as AssistantProfilePatch[],
  resolvedDefault: "catalog-default",
  resolvedOverride: "",
  sourceSettings: [] as { id: string; value: string }[],
  defaultAvailable: true,
}));
vi.mock("../../../shared/i18n", () => ({
  t: (key: string, values: Record<string, unknown> = {}) =>
    key.replace(/\{(p\d+)\}/g, (_, name) => String(values[name] ?? `{${name}}`)),
  useT: () => (key: string) => key,
}));
vi.mock("../../sessions/ui/modelSource", () => ({
  useModelSource: () => ({
    resolve: (harness: string, model: string) => ({
      harness,
      id: observed.resolvedOverride || model || observed.resolvedDefault,
      settings: [{ id: "effort", value: "default" }, ...observed.sourceSettings],
    }),
    available: () => observed.defaultAvailable,
    modelsFor: (harness: string) =>
      observed.defaultAvailable ? [{ harness, id: observed.resolvedDefault }] : [],
  }),
}));
vi.mock("../../sessions/model/models", () => ({
  resolveModel: (harness: string, model: string) => ({ harness, id: model }),
  defaultModelSettings: (model: { settings?: { id: string; value: string }[] }) =>
    model.settings
      ? Object.fromEntries(model.settings.map((setting) => [setting.id, setting.value]))
      : { effort: "default" },
}));
vi.mock("../../sessions/ui/ModelPicker", () => ({
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
        props.inheritChoice?.selected ? props.inheritChoice.label : props.model || "Choose model",
      ),
      createElement(
        "button",
        {
          type: "button",
          onClick: () => props.onSettingsChange({ ...props.values, effort: "low" }),
        },
        "Adjust effort",
      ),
      props.inheritChoice
        ? createElement(
            "button",
            { type: "button", onClick: props.inheritChoice.onSelect },
            "Inherit",
          )
        : null,
    ),
}));
import { AssistantProfileFields } from "./AssistantProfileFields";
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
  section: "autonomy" | "cost" | "presence" | "identity" = "autonomy",
) {
  observed.patches = [];
  observed.resolvedDefault = "catalog-default";
  observed.resolvedOverride = "";
  observed.sourceSettings = [];
  observed.defaultAvailable = true;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  function Form() {
    const [value, setValue] = useState(initial);
    return createElement(AssistantProfileFields, {
      section,
      value,
      onChange: (patch) => {
        observed.patches.push(patch);
        setValue((current) => ({ ...current, ...patch }));
      },
    });
  }
  await act(async () => root!.render(createElement(Form)));
}
async function click(text: string, scope: ParentNode = container) {
  const target = [...scope.querySelectorAll("button")].find(
    (button) => button.textContent === text || button.getAttribute("aria-label") === text,
  );
  expect(target).toBeTruthy();
  await act(async () => target!.click());
}
function field(label: string) {
  return [...container.querySelectorAll("fieldset")].find(
    (field) => field.querySelector("legend")?.textContent === label,
  )!;
}
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  vi.unstubAllGlobals();
});
it("keeps a saved zero follow-up limit visible and does not silently enable it", async () => {
  await setup({ nudgeLimit: 0, chiefWakeLimit: 11 }, "cost");
  const values = [...container.querySelectorAll<HTMLInputElement>('input[type="number"]')].map(
    (input) => input.value,
  );
  expect(values.slice(0, 2)).toEqual(["11", "0"]);
  expect(observed.patches).toEqual([]);
  await click("About cost and context");
  expect(document.body.textContent).toContain("Zero disables follow-ups and automatic recovery.");
});
it("retains invalid presence thresholds for owner correction while showing the relationship error", async () => {
  await setup(
    {
      idleMinutes: 90,
      awayMinutes: 30,
      activeStart: 22,
      activeEnd: 6,
      notificationPresent: "none",
      notificationAway: "urgent",
    },
    "presence",
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Away must start later than idle.",
  );
  expect(
    container.querySelector<HTMLInputElement>(
      'input[aria-label="Custom Become idle after (minutes)"]',
    )?.value,
  ).toBe("90");
  expect(container.querySelector('button[aria-label="Work hours start: 22:00"]')).toBeTruthy();
  expect(container.querySelector('button[aria-label="Work hours end: 06:00"]')).toBeTruthy();
  expect(observed.patches).toEqual([]);
  await click("About availability");
  expect(document.body.textContent).toContain("Do not disturb and quiet hours hold notifications");
});
it("keeps worker context defaults independent of supervisor limits and exposes only explicit advanced edits", async () => {
  await setup({ chiefSoftContext: 20000, chiefHardContext: 40000 }, "cost");
  await click("About cost and context");
  expect(document.body.textContent).toContain("Codex uses a local text limit");
  await click("About cost and context");
  expect(container.textContent).not.toContain("Compact worker context at (tokens)");
  await click("Advanced worker context limits");
  const values = [...container.querySelectorAll<HTMLInputElement>('input[type="number"]')].map(
    (input) => input.value,
  );
  expect(values).toEqual(["20", "2", "20", "", "20000", "40000", "150000", "300000", "50", "80"]);
  expect(observed.patches).toEqual([]);
  await click("Advanced worker context limits");
  await click("Advanced worker context limits");
  expect(observed.patches).toEqual([]);
});
it("keeps an invalid worker threshold draft visible instead of normalizing it into a silent save", async () => {
  await setup({ workerSoftContext: 40000, workerHardContext: 30000 }, "cost");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Worker context limits must increase from compact to handoff.",
  );
  await click("Advanced worker context limits");
  expect(
    [...container.querySelectorAll<HTMLInputElement>('input[type="number"]')].map(
      (input) => input.value,
    ),
  ).toContain("40000");
  expect(observed.patches).toEqual([]);
});
it("keeps advanced roles optional and preserves existing explicit roles until consciously changed", async () => {
  const chief = {
    ...execution,
    harness: "claude" as const,
    model: "saved-chief",
  };
  await setup({ execution, chiefExecution: chief, replyExecution: null });
  expect(container.textContent).toContain("Worker model");
  expect(container.textContent).not.toContain("Supervisor model");
  expect(observed.patches).toEqual([]);
  await click("Advanced role models");
  expect(field("Supervisor model").textContent).toContain("saved-chief");
  expect(field("Conversation model").textContent).toContain("Use worker model");
  await click("Advanced role models");
  await click("Advanced role models");
  expect(field("Supervisor model").textContent).toContain("saved-chief");
  expect(observed.patches).toEqual([]);
});
it("changes only the selected role, preserves worker permissions, and explicitly restores inheritance", async () => {
  await setup({ execution });
  await click("Advanced role models");
  await click("Use worker model", field("Planning model"));
  expect(observed.patches.at(-1)).toEqual({
    planningExecution: {
      ...execution,
      harness: "claude",
      model: "selected-model",
      modelSettings: { effort: "default" },
    },
  });
  await click("Adjust effort", field("Planning model"));
  expect(observed.patches.at(-1)?.planningExecution?.modelSettings).toEqual({
    effort: "low",
  });
  expect(
    observed.patches.every(
      (patch) =>
        !Object.hasOwn(patch, "execution") &&
        !Object.hasOwn(patch, "chiefExecution") &&
        !Object.hasOwn(patch, "replyExecution"),
    ),
  ).toBe(true);
  await click("Inherit", field("Planning model"));
  expect(observed.patches.at(-1)).toEqual({ planningExecution: null });
  expect(execution.modelSettings).toEqual({
    effort: "high",
    custom: "retained",
  });
});
it("editing an inherited role effort creates an explicit clone instead of modifying worker settings", async () => {
  await setup({ execution });
  await click("Advanced role models");
  await click("Adjust effort", field("Conversation model"));
  expect(observed.patches.at(-1)).toEqual({
    replyExecution: {
      ...execution,
      modelSettings: { effort: "low", custom: "retained" },
    },
  });
  expect(execution.modelSettings.effort).toBe("high");
});
it("keeps routine worker answers opt-in without changing model or execution authority", async () => {
  await setup({ execution });
  const toggle = container.querySelector('button[role="switch"],input[role="switch"]') as
    | HTMLButtonElement
    | HTMLInputElement;
  expect(toggle).toBeTruthy();
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  await act(async () => toggle.click());
  expect(observed.patches.at(-1)).toEqual({ allowRoutineQuestions: true });
  await click("About autonomy");
  expect(document.body.textContent).toContain(
    "Permissions, publication, credentials and destructive requests still require you.",
  );
});

async function edit(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function choose(label: string, option: string) {
  const trigger = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.getAttribute("aria-label")?.startsWith(`${label}:`),
  );
  expect(trigger).toBeTruthy();
  await act(async () => trigger!.click());
  const selected = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (node) => node.textContent === option,
  );
  expect(selected).toBeTruthy();
  await act(async () => selected!.click());
}

it("keeps exact custom budgets and invalid drafts until an explicit preset replaces them", async () => {
  await setup({ execution, dailyTokenBudget: 1_234_567 });
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="Custom Daily token budget"]',
  )!;
  expect(input.value).toBe("1234567");
  expect(observed.patches).toEqual([]);
  await edit(input, "1234569");
  expect(observed.patches.at(-1)).toEqual({ dailyTokenBudget: 1_234_569 });
  expect(input.value).toBe("1234569");
  await edit(input, "");
  expect(Number.isNaN(observed.patches.at(-1)?.dailyTokenBudget)).toBe(true);
  expect(input.value).toBe("");
  await choose("Daily token budget", "1m tokens/day");
  expect(observed.patches.at(-1)).toEqual({ dailyTokenBudget: 1_000_000 });
  expect(container.querySelector('input[aria-label="Custom Daily token budget"]')).toBeNull();
});

it("keeps the unconfigured zero budget invalid and switching to Custom does not rewrite a preset", async () => {
  await setup({ dailyTokenBudget: 0 });
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="Custom Daily token budget"]',
  )!;
  expect(input.value).toBe("0");
  expect(input.checkValidity()).toBe(false);
  expect(container.querySelector('button[aria-label="Daily token budget: Not set"]')).toBeTruthy();
  expect(observed.patches).toEqual([]);
  await choose("Daily token budget", "500k tokens/day");
  await choose("Daily token budget", "Custom");
  expect(
    container.querySelector<HTMLInputElement>('input[aria-label="Custom Daily token budget"]')!
      .value,
  ).toBe("500000");
  expect(observed.patches).toEqual([{ dailyTokenBudget: 500000 }]);
});

it("preserves overnight hours and restores them after explicit all-day and quiet-hours toggles", async () => {
  await setup({ activeStart: 22, activeEnd: 6, quietStart: 23, quietEnd: 7 }, "presence");
  expect(observed.patches).toEqual([]);
  await click("Work all day");
  expect(observed.patches.at(-1)).toEqual({ activeStart: 22, activeEnd: 22 });
  await click("Work all day");
  expect(observed.patches.at(-1)).toEqual({ activeStart: 22, activeEnd: 6 });
  await choose("Work hours end", "00:00");
  expect(observed.patches.at(-1)).toEqual({ activeStart: 22, activeEnd: 0 });
  await click("Quiet hours");
  expect(observed.patches.at(-1)).toEqual({ quietStart: 23, quietEnd: 23 });
  await click("Quiet hours");
  expect(observed.patches.at(-1)).toEqual({ quietStart: 23, quietEnd: 7 });
});

it("direct effort editing materializes the displayed default only on that owner action", async () => {
  await setup({ execution: null });
  expect(observed.patches).toEqual([]);
  await click("Adjust effort", field("Worker model"));
  expect(observed.patches).toEqual([
    {
      execution: {
        harness: "codex",
        model: "catalog-default",
        modelSettings: { effort: "low" },
        runtimeMode: "supervised",
        maxRunMinutes: 60,
      },
    },
  ]);
});

it("keeps both hour controls available through an intermediate equal range", async () => {
  await setup({ activeStart: 22, activeEnd: 8, quietStart: 23, quietEnd: 7 }, "presence");
  await choose("Work hours start", "08:00");
  expect(observed.patches.at(-1)).toEqual({ activeStart: 8, activeEnd: 8 });
  expect(
    container.querySelector('button[aria-label="Work all day"]')?.getAttribute("aria-checked"),
  ).toBe("true");
  expect(container.querySelector('button[aria-label="Work hours end: 08:00"]')).toBeTruthy();
  await choose("Work hours end", "18:00");
  expect(observed.patches.at(-1)).toEqual({ activeStart: 8, activeEnd: 18 });
  await choose("Quiet hours start", "07:00");
  expect(observed.patches.at(-1)).toEqual({ quietStart: 7, quietEnd: 7 });
  expect(
    container.querySelector('button[aria-label="Quiet hours"]')?.getAttribute("aria-checked"),
  ).toBe("false");
  await choose("Quiet hours end", "09:00");
  expect(observed.patches.at(-1)).toEqual({ quietStart: 7, quietEnd: 9 });
  await click("Quiet hours");
  expect(container.querySelector('button[aria-label^="Quiet hours end:"]')).toBeNull();
});

it("uses the live source default for an empty model and preserves saved account and custom settings on reload", async () => {
  await setup({
    execution: {
      ...execution,
      harness: "claude",
      model: "",
      modelSettings: { accountId: "owner-account", custom: "retained" },
    },
  });
  observed.resolvedDefault = "late-source-default";
  await click("Adjust effort", field("Worker model"));
  const saved = observed.patches.at(-1)!;
  expect(saved.execution).toEqual({
    ...execution,
    harness: "claude",
    model: "late-source-default",
    modelSettings: { effort: "low", accountId: "owner-account", custom: "retained" },
  });
  await act(async () => root!.unmount());
  container.remove();
  await setup(saved);
  expect(observed.patches).toEqual([]);
  expect(field("Worker model").textContent).toContain("late-source-default");
  await click("Adjust effort", field("Worker model"));
  expect(observed.patches.at(-1)).toEqual(saved);
});

it("an unset inherited role effort creates only that role using the resolved source identity", async () => {
  await setup({ execution: null, replyExecution: null });
  await click("Advanced role models");
  expect(observed.patches).toEqual([]);
  await click("Adjust effort", field("Conversation model"));
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

it("materializes the available displayed default only when the owner enables job execution", async () => {
  await setup({ autonomy: "report", execution: null });
  expect(observed.patches).toEqual([]);
  await choose("Autonomy", "Run jobs");
  expect(observed.patches).toEqual([
    {
      autonomy: "jobs",
      execution: {
        harness: "codex",
        model: "catalog-default",
        modelSettings: { effort: "default" },
        runtimeMode: "supervised",
        maxRunMinutes: 60,
      },
    },
  ]);
});

it("does not replace an existing worker when changing supervision mode", async () => {
  await setup({ autonomy: "report", execution });
  await choose("Autonomy", "Supervise assigned jobs");
  expect(observed.patches).toEqual([{ autonomy: "chief" }]);
  expect(execution.modelSettings).toEqual({ effort: "high", custom: "retained" });
});

it("requires an explicit worker choice when the default catalog is unavailable", async () => {
  await setup({ autonomy: "report", execution: null });
  observed.defaultAvailable = false;
  await choose("Autonomy", "Run jobs");
  expect(observed.patches).toEqual([]);
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Choose a worker model before enabling job execution.",
  );
  await click("Choose model", field("Worker model"));
  await choose("Autonomy", "Run jobs");
  expect(observed.patches.at(-1)).toEqual({ autonomy: "jobs" });
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("keeps the dynamic title preview available beside its switch without an extra prose row", async () => {
  await setup({ name: "Ada", showTitle: true }, "identity");
  expect(container.textContent).not.toContain("Room · Ada");
  await click("Preview");
  expect(document.body.textContent).toContain("Assistant Ada");
  expect(document.body.textContent).toContain("Room · Ada");
  expect(observed.patches).toEqual([]);
});

it("does not materialize a fallback model from an unavailable catalog on a direct settings edit", async () => {
  await setup({ execution: null });
  observed.defaultAvailable = false;
  await click("Adjust effort", field("Worker model"));
  expect(observed.patches).toEqual([]);
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Choose an available model before changing its settings.",
  );
});

it("preserves an existing unknown model and account when its catalog resolves a different fallback", async () => {
  const saved = {
    ...execution,
    model: "saved-private-model",
    modelSettings: { accountId: "saved-account", custom: "retained" },
  };
  await setup({ execution: saved });
  observed.defaultAvailable = false;
  observed.resolvedOverride = "baked-fallback";
  await click("Adjust effort", field("Worker model"));
  expect(observed.patches).toEqual([
    { execution: { ...saved, modelSettings: { ...saved.modelSettings, effort: "low" } } },
  ]);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("materializes all actual source defaults while changing only effort on an unconfigured model", async () => {
  await setup({
    execution: { ...execution, model: "", modelSettings: { accountId: "saved-account" } },
  });
  observed.sourceSettings = [
    { id: "fast", value: "true" },
    { id: "contextWindow", value: "200000" },
  ];
  await click("Adjust effort", field("Worker model"));
  expect(observed.patches.at(-1)?.execution).toEqual({
    ...execution,
    model: "catalog-default",
    modelSettings: {
      effort: "low",
      fast: "true",
      contextWindow: "200000",
      accountId: "saved-account",
    },
  });
});

it("clears a failed default-role settings error after an explicit valid role selection", async () => {
  await setup({ execution: null });
  await click("Advanced role models");
  observed.defaultAvailable = false;
  await click("Adjust effort", field("Conversation model"));
  expect(container.querySelector('[role="alert"]')).toBeTruthy();
  expect(observed.patches).toEqual([]);
  await click("Use worker model", field("Conversation model"));
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(observed.patches.at(-1)?.replyExecution?.model).toBe("selected-model");
});

it("keeps task observation default off but lets the owner save a preference while unavailable", async () => {
  await setup({}, "presence");
  expect(container.textContent).toContain("Task observation readiness is not confirmed.");
  const complete = container.querySelector<HTMLButtonElement>(
    'button[role="switch"][aria-label="Notify when an observed task completes"]',
  );
  expect(complete?.disabled).toBe(false);
  expect(complete?.getAttribute("aria-checked")).toBe("false");
  expect(observed.patches).toEqual([]);
  await act(async () => complete!.click());
  expect(observed.patches.at(-1)).toMatchObject({ observationTaskDone: true });
});
