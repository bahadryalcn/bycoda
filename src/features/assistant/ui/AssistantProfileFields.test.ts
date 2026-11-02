// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { AssistantProfilePatch } from "../../../shared/model/host-contracts/assistant";
const observed = vi.hoisted(() => ({ patches: [] as AssistantProfilePatch[] }));
vi.mock("../../../shared/i18n", () => ({
  t: (key: string) => key,
  useT: () => (key: string) => key,
}));
vi.mock("../../sessions/model/models", () => ({
  resolveModel: (harness: string, model: string) => ({ harness, id: model }),
  defaultModelSettings: () => ({ effort: "default" }),
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
        props.inheritChoice?.selected
          ? props.inheritChoice.label
          : props.model || "Choose model",
      ),
      createElement(
        "button",
        {
          type: "button",
          onClick: () =>
            props.onSettingsChange({ ...props.values, effort: "low" }),
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
  section: "autonomy" | "cost" | "presence" = "autonomy",
) {
  observed.patches = [];
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
    (button) => button.textContent === text,
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
it("keeps a saved zero follow-up limit visible and does not silently enable it",async()=>{
 await setup({nudgeLimit:0,chiefWakeLimit:11},"cost");
 const values=[...container.querySelectorAll<HTMLInputElement>('input[type="number"]')].map(input=>input.value);
 expect(values.slice(0,2)).toEqual(["11","0"]);expect(observed.patches).toEqual([]);
 expect(container.textContent).toContain("Zero disables follow-ups and automatic recovery.");
});
it("retains invalid presence thresholds for owner correction while showing the relationship error",async()=>{
 await setup({idleMinutes:90,awayMinutes:30,activeStart:22,activeEnd:6,notificationPresent:"none",notificationAway:"urgent"},"presence");
 expect(container.querySelector('[role="alert"]')?.textContent).toBe("Away must start later than idle.");
 expect([...container.querySelectorAll<HTMLInputElement>('input[type="number"]')].slice(0,4).map(input=>input.value)).toEqual(["90","30","22","6"]);
 expect(observed.patches).toEqual([]);expect(container.textContent).toContain("Do not disturb and quiet hours hold notifications");
});
it("keeps worker context defaults independent of supervisor limits and exposes only explicit advanced edits", async () => {
  await setup({ chiefSoftContext: 20000, chiefHardContext: 40000 }, "cost");
  expect(container.textContent).toContain("Codex uses a local text limit");
  expect(container.textContent).not.toContain(
    "Compact worker context at (tokens)",
  );
  await click("Advanced worker context limits");
  const values = [
    ...container.querySelectorAll<HTMLInputElement>('input[type="number"]'),
  ].map((input) => input.value);
  expect(values).toEqual([
    "20",
    "2",
    "20",
    "",
    "20000",
    "40000",
    "150000",
    "300000",
    "50",
    "80",
  ]);
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
    [
      ...container.querySelectorAll<HTMLInputElement>('input[type="number"]'),
    ].map((input) => input.value),
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
  const toggle = container.querySelector(
    'button[role="switch"],input[role="switch"]',
  ) as HTMLButtonElement | HTMLInputElement;
  expect(toggle).toBeTruthy();
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  await act(async () => toggle.click());
  expect(observed.patches.at(-1)).toEqual({ allowRoutineQuestions: true });
  expect(container.textContent).toContain(
    "Permissions, publication, credentials and destructive requests still require you.",
  );
});
