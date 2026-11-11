// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { AssistantProfilePatch } from "../../../../shared/model/host-contracts/assistant";
const observed = vi.hoisted(() => ({
  patches: [] as AssistantProfilePatch[],
  defaultAvailable: true,
}));
vi.mock("../../../settings/public/settingsControls", async () => {
  const { createElement } = await import("react");
  return {
    Row: ({ label, children }: any) =>
      createElement("div", { role: "group", "aria-label": label }, children),
  };
});
vi.mock("../../../../shared/i18n", () => ({
  t: (key: string) => key,
  useT: () => (key: string) => key,
}));
vi.mock("../../../sessions/ui/modelSource", () => ({
  useModelSource: () => ({
    resolve: (harness: string) => ({ harness, id: "catalog-default", settings: [] }),
    available: () => observed.defaultAvailable,
    modelsFor: (harness: string) =>
      observed.defaultAvailable ? [{ harness, id: "catalog-default" }] : [],
  }),
}));
vi.mock("../../../sessions/model/models", () => ({
  resolveModel: (harness: string, model: string) => ({ harness, id: model }),
  defaultModelSettings: () => ({ effort: "default" }),
}));
import { AssistantWorkModeField } from "./AssistantWorkModeField";
import { ProfileRowsProvider } from "./SettingsProfileRow";

let root: Root | undefined, container: HTMLDivElement;
const execution = {
  harness: "codex" as const,
  model: "owner-worker",
  modelSettings: { effort: "high" },
  runtimeMode: "full-access" as const,
  maxRunMinutes: 45,
};

async function setup(initial: AssistantProfilePatch, unchosen = false, rows = true) {
  observed.patches = [];
  observed.defaultAvailable = true;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  function Form() {
    const [value, setValue] = useState(initial);
    return createElement(
      ProfileRowsProvider,
      { value: rows },
      createElement(AssistantWorkModeField, {
        value,
        unchosen,
        onChange: (patch: AssistantProfilePatch) => {
          observed.patches.push(patch);
          setValue((current) => ({ ...current, ...patch }));
        },
      }),
    );
  }
  await act(async () => root!.render(createElement(Form)));
}
const radios = () => [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
const checked = () =>
  radios()
    .filter((radio) => radio.checked)
    .map((radio) => radio.value);
async function choose(value: string) {
  const radio = radios().find((input) => input.value === value);
  expect(radio, value).toBeTruthy();
  await act(async () => radio!.click());
}
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  vi.unstubAllGlobals();
});

it("offers the three work modes with a one-line description each", async () => {
  await setup({
    autonomy: "chief",
    planApproval: "large",
    confirmJobs: true,
    allowRoutineQuestions: true,
    execution: { ...execution, runtimeMode: "supervised" },
  });
  expect(radios().map((radio) => radio.value)).toEqual(["watch", "ask", "free"]);
  expect(checked()).toEqual(["ask"]);
  expect(container.textContent).toContain(
    "Talks with you and reports what happens. Starts no jobs.",
  );
  expect(container.textContent).toContain("Runs jobs you assign. Asks before commands");
  expect(container.textContent).toContain("Runs jobs without asking.");
  expect(container.textContent).not.toContain("Custom");
});

it("applies every job control of the chosen mode and keeps the worker model", async () => {
  await setup({
    autonomy: "chief",
    planApproval: "large",
    confirmJobs: true,
    allowRoutineQuestions: true,
    execution: { ...execution, runtimeMode: "supervised" },
  });
  await choose("free");
  expect(observed.patches).toEqual([
    {
      autonomy: "chief",
      planApproval: "never",
      confirmJobs: false,
      allowRoutineQuestions: true,
      execution: { ...execution, runtimeMode: "full-access" },
    },
  ]);
  await choose("watch");
  expect(observed.patches.at(-1)).toEqual({
    autonomy: "report",
    planApproval: "always",
    confirmJobs: true,
    allowRoutineQuestions: false,
    execution: { ...execution, runtimeMode: "supervised" },
  });
  expect(checked()).toEqual(["watch"]);
});

it("shows Custom when the job controls match no mode and leaves them alone", async () => {
  await setup({ autonomy: "jobs", planApproval: "never", execution });
  expect(radios().map((radio) => radio.value)).toEqual(["watch", "ask", "free", "custom"]);
  expect(checked()).toEqual(["custom"]);
  expect(container.textContent).toContain("Custom");
  await choose("custom");
  expect(observed.patches).toEqual([]);
  await choose("ask");
  expect(checked()).toEqual(["ask"]);
  expect(radios().map((radio) => radio.value)).toEqual(["watch", "ask", "free"]);
});

it("treats a changed execution permission as Custom", async () => {
  await setup({
    autonomy: "chief",
    planApproval: "large",
    confirmJobs: true,
    allowRoutineQuestions: true,
    execution: { ...execution, runtimeMode: "auto-accept-edits" },
  });
  expect(checked()).toEqual(["custom"]);
});

it("gives a job mode without a worker the default worker, with the mode's permission", async () => {
  await setup({
    autonomy: "report",
    planApproval: "always",
    confirmJobs: true,
    allowRoutineQuestions: false,
    execution: null,
  });
  await choose("free");
  expect(observed.patches).toEqual([
    {
      autonomy: "chief",
      planApproval: "never",
      confirmJobs: false,
      allowRoutineQuestions: true,
      execution: {
        harness: "codex",
        model: "catalog-default",
        modelSettings: { effort: "default" },
        runtimeMode: "full-access",
        maxRunMinutes: 60,
      },
    },
  ]);
});

it("keeps the profile unchanged and asks for a worker when no default model is available", async () => {
  await setup({
    autonomy: "report",
    planApproval: "never",
    confirmJobs: true,
    allowRoutineQuestions: false,
    execution: null,
  });
  observed.defaultAvailable = false;
  await choose("ask");
  expect(observed.patches).toEqual([]);
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Choose a worker model before enabling job execution.",
  );
  // A mode that starts no work needs no worker.
  await choose("watch");
  expect(observed.patches).toHaveLength(1);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("selects nothing and offers no Custom option on a first setup that has not chosen", async () => {
  await setup({ autonomy: "report", execution: null }, true, false);
  expect(radios().map((radio) => radio.value)).toEqual(["watch", "ask", "free"]);
  expect(checked()).toEqual([]);
  await choose("watch");
  expect(checked()).toEqual(["watch"]);
});
