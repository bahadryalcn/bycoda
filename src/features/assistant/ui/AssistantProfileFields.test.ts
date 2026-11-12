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
vi.mock("../../settings/public/settingsControls", async () => {
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
import { AssistantProfileFields } from "./AssistantProfileFields";
import { AssistantCostInfo } from "./settings/AssistantCostFields";
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
  section:
    | "jobs"
    | "budget"
    | "permissions"
    | "workmode"
    | "cost"
    | "presence"
    | "identity"
    | "personality" = "jobs",
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
  const target = [...scope.querySelectorAll("button, summary")].find(
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
it("keeps a saved zero follow-up limit visible and does not silently enable it", async () => {
  await setup({ nudgeLimit: 0, chiefWakeLimit: 11 }, "cost");
  const values = [...container.querySelectorAll<HTMLInputElement>('input[type="number"]')].map(
    (input) => input.value,
  );
  expect(values.slice(0, 2)).toEqual(["11", "0"]);
  expect(observed.patches).toEqual([]);
});
it("explains cost and context limits in the info popover beside the section title", async () => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(AssistantCostInfo)));
  await click("About cost and context");
  expect(document.body.textContent).toContain(
    "Local scheduling limits, not a provider billing cap.",
  );
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
    container.querySelector<HTMLInputElement>('input[aria-label="Custom Idle after"]')?.value,
  ).toBe("90");
  expect(container.querySelector('button[aria-label="Work hours start: 22:00"]')).toBeTruthy();
  expect(container.querySelector('button[aria-label="Work hours end: 06:00"]')).toBeTruthy();
  expect(observed.patches).toEqual([]);
  await click("About availability");
  expect(document.body.textContent).toContain("Do not disturb and quiet hours hold notifications");
});
it("keeps worker context defaults independent of supervisor limits and exposes only explicit advanced edits", async () => {
  await setup({ chiefSoftContext: 20000, chiefHardContext: 40000 }, "cost");
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
it("keeps routine worker answers opt-in without changing model or execution authority", async () => {
  await setup({ execution });
  const row = [...container.querySelectorAll("div")].find(
    (element) =>
      element.querySelector("p")?.textContent ===
      "Never approves permissions, publishing, credentials or destructive actions.",
  )!;
  const toggle = row.querySelector('button[role="switch"],input[role="switch"]') as
    | HTMLButtonElement
    | HTMLInputElement;
  expect(toggle).toBeTruthy();
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  await act(async () => toggle.click());
  expect(observed.patches.at(-1)).toEqual({ allowRoutineQuestions: true });
  expect(container.textContent).toContain(
    "Never approves permissions, publishing, credentials or destructive actions.",
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
  await setup({ execution, dailyTokenBudget: 1_234_567 }, "budget");
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
  await setup({ dailyTokenBudget: 0 }, "budget");
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
  await click("Work hours");
  expect(observed.patches.at(-1)).toEqual({ activeStart: 22, activeEnd: 22 });
  await click("Work hours");
  expect(observed.patches.at(-1)).toEqual({ activeStart: 22, activeEnd: 6 });
  await choose("Work hours end", "00:00");
  expect(observed.patches.at(-1)).toEqual({ activeStart: 22, activeEnd: 0 });
  await click("Quiet hours");
  expect(observed.patches.at(-1)).toEqual({ quietStart: 23, quietEnd: 23 });
  await click("Quiet hours");
  expect(observed.patches.at(-1)).toEqual({ quietStart: 23, quietEnd: 7 });
});

it("keeps both hour controls available through an intermediate equal range", async () => {
  await setup({ activeStart: 22, activeEnd: 8, quietStart: 23, quietEnd: 7 }, "presence");
  await choose("Work hours start", "08:00");
  expect(observed.patches.at(-1)).toEqual({ activeStart: 8, activeEnd: 8 });
  // Equal start and end is all day: the work hours switch is off and the range stays editable.
  expect(
    container.querySelector('button[aria-label="Work hours"]')?.getAttribute("aria-checked"),
  ).toBe("false");
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
  observed.defaultAvailable = true;
  await choose("Autonomy", "Run jobs");
  expect(observed.patches.at(-1)?.autonomy).toBe("jobs");
  expect(observed.patches.at(-1)?.execution?.model).toBe("catalog-default");
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

it("keeps task observation default off but lets the owner save a preference while unavailable", async () => {
  await setup({}, "presence");
  expect(container.textContent).toContain("Readiness not confirmed");
  const complete = container.querySelector<HTMLButtonElement>(
    'button[role="switch"][aria-label="Task done"]',
  );
  expect(complete?.disabled).toBe(false);
  expect(complete?.getAttribute("aria-checked")).toBe("false");
  expect(observed.patches).toEqual([]);
  await act(async () => complete!.click());
  expect(observed.patches.at(-1)).toMatchObject({ observationTaskDone: true });
});

it("saves address frequency, tone, profanity and persona as profile drafts without a new permission", async () => {
  await setup(
    { addressFrequency: "sometimes", tone: "friendly", allowProfanity: false },
    "identity",
  );
  const never = container.querySelector<HTMLInputElement>('input[type="radio"][value="never"]')!;
  expect(never.labels?.[0]?.textContent).toContain("Never");
  await act(async () => never.click());
  expect(observed.patches.at(-1)).toEqual({ addressFrequency: "never" });
  await setup({ tone: "friendly", allowProfanity: false, persona: "" }, "personality");
  await choose("Tone", "Blunt");
  expect(observed.patches.at(-1)).toEqual({ tone: "blunt" });
  const toggle = container.querySelector<HTMLButtonElement>(
    'button[role="switch"][aria-label="Allow profanity"]',
  )!;
  await act(async () => toggle.click());
  expect(observed.patches.at(-1)).toEqual({ allowProfanity: true });
  const persona = container.querySelector<HTMLTextAreaElement>("textarea")!;
  expect(persona.getAttribute("maxlength")).toBe("2000");
  expect(persona.getAttribute("placeholder")).toBe(
    "e.g. Talk like a laid-back teammate, short answers",
  );
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      persona,
      "Short answers",
    );
    persona.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(observed.patches.at(-1)).toEqual({ persona: "Short answers" });
});

it("keeps job confirmation off by default and saves the owner's choice from the work tab", async () => {
  await setup({ autonomy: "chief", execution });
  const confirm = container.querySelector<HTMLButtonElement>(
    'button[role="switch"][aria-label="Confirm jobs before starting"]',
  )!;
  expect(confirm.getAttribute("aria-checked")).toBe("false");
  await act(async () => confirm.click());
  expect(observed.patches.at(-1)).toEqual({ confirmJobs: true });
});

it("chooses execution permissions from the icon picker and keeps the selected mode's description visible", async () => {
  await setup({ autonomy: "chief", execution }, "permissions");
  expect(container.textContent).toContain("Ask before commands and file changes.");
  const edits = container.querySelector<HTMLElement>('[aria-label="Auto-accept edits"]')!;
  expect(edits).toBeTruthy();
  await act(async () => edits.click());
  expect(observed.patches.at(-1)).toEqual({
    execution: { ...execution, runtimeMode: "auto-accept-edits" },
  });
});
