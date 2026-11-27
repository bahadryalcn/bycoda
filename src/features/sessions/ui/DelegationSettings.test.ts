// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  CROSS_ADVISOR_KEY,
  CROSS_SUBAGENTS_KEY,
  DELEGATION_LIMITS,
  decodeSubagents,
  encodeAdvisor,
  encodeSubagents,
  type DelegateModelRef,
} from "../../../shared/model/host-contracts/delegation";
import {
  crossDelegationSettings,
  crossDelegationSummary,
  delegationNextValue,
  delegationOptionSelected,
  type DelegationInput,
} from "../model/crossDelegation";
import type { AgentModel, ModelSetting } from "../model/models";
import { HARNESS_TITLE } from "../../../shared/model/harnessIdentity";
import { delegationPickerOptions } from "./DelegationSettings";
import { DelegationSelectionControl } from "./DelegationSelectionControl";
import { AdvisorControl } from "./AdvisorControl";

// A plain surface that keeps the menu's role, ref and key handling, and dismisses on Escape like the real popover.
vi.mock("../../../shared/ui/Popover", async () => ({
  ...(await vi.importActual<typeof import("../../../shared/ui/Popover")>(
    "../../../shared/ui/Popover",
  )),
  Popover: ({
    children,
    ref,
    role,
    onKeyDown,
    onDismiss,
  }: {
    children: ReactNode;
    ref?: React.Ref<HTMLDivElement>;
    role?: string;
    onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
    onDismiss?: (reason: string) => void;
  }) =>
    createElement(
      "div",
      {
        ref,
        role,
        onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
          onKeyDown?.(event);
          if (event.key === "Escape") onDismiss?.("escape");
        },
      },
      children,
    ),
}));

const codex = {
  id: "codex:gpt-6.1-sol",
  harness: "codex",
  name: "GPT 6.1 Sol",
  nativeId: "gpt-6.1-sol",
} as AgentModel;
const cursor = {
  id: "cursor:composer-2",
  harness: "cursor",
  name: "Composer 2",
  nativeId: "composer-2",
} as AgentModel;
const claude = {
  id: "claude:sonnet-5",
  harness: "claude",
  name: "Sonnet 5",
  nativeId: "sonnet-5",
} as AgentModel;

const ref = (model: AgentModel): DelegateModelRef => ({
  harness: model.harness as DelegateModelRef["harness"],
  model: model.id,
});

function input(values: Record<string, string> = {}): DelegationInput {
  const models: Record<string, AgentModel[]> = {
    claude: [claude],
    codex: [codex],
    cursor: [cursor],
  };
  return {
    current: claude,
    harnesses: ["claude", "codex", "cursor"],
    source: { modelsFor: (harness) => models[harness] ?? [] },
    values,
    unavailable: (name) => `Unavailable · ${name}`,
  };
}

function setting(id: string, values: Record<string, string> = {}): ModelSetting {
  const found = crossDelegationSettings(input(values)).find((item) => item.id === id);
  if (!found) throw new Error(`no ${id} setting`);
  return found;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function renderControl(values: Record<string, string>, onChange = vi.fn()) {
  act(() =>
    root.render(
      createElement(DelegationSelectionControl, {
        label: "Subagents",
        setting: setting(CROSS_SUBAGENTS_KEY, values),
        value: values[CROSS_SUBAGENTS_KEY],
        onChange,
      }),
    ),
  );
  return onChange;
}

const mode = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
    (node) => node.textContent === label,
  )!;
const button = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.getAttribute("aria-label") === label || node.textContent === label,
  )!;

it("summarises the saved subagents: Off, the one model, then the first plus a count", () => {
  const one = { [CROSS_SUBAGENTS_KEY]: encodeSubagents([ref(codex)])! };
  const two = { [CROSS_SUBAGENTS_KEY]: encodeSubagents([ref(codex), ref(cursor)])! };
  expect(crossDelegationSummary(setting(CROSS_SUBAGENTS_KEY), {})).toBe("Off");
  expect(crossDelegationSummary(setting(CROSS_SUBAGENTS_KEY, one), one)).toBe("GPT 6.1 Sol");
  expect(crossDelegationSummary(setting(CROSS_SUBAGENTS_KEY, two), two)).toBe("GPT 6.1 Sol +1");
});

it("keeps the subagent list at the limit and ignores the next pick", () => {
  const many: AgentModel[] = Array.from(
    { length: DELEGATION_LIMITS.subagentModels + 1 },
    (_, index) =>
      ({
        id: `codex:model-${index}`,
        harness: "codex",
        name: `Model ${index}`,
        nativeId: `model-${index}`,
      }) as AgentModel,
  );
  const full = encodeSubagents(many.slice(0, DELEGATION_LIMITS.subagentModels).map(ref))!;
  const manySetting = crossDelegationSettings({
    ...input({ [CROSS_SUBAGENTS_KEY]: full }),
    harnesses: ["codex"],
    source: { modelsFor: () => many },
  }).find((item) => item.id === CROSS_SUBAGENTS_KEY)!;
  const extra = manySetting.options.find(
    (option) => option.value === encodeAdvisor(ref(many.at(-1)!)),
  )!;
  const next = delegationNextValue(manySetting, { [CROSS_SUBAGENTS_KEY]: full }, extra.value);
  expect(decodeSubagents(next)).toHaveLength(DELEGATION_LIMITS.subagentModels);
  expect(next).toBe(full);
});

it("advisor: Off is the empty value and is selected when no advisor is saved", () => {
  const advisor = setting(CROSS_ADVISOR_KEY);
  expect(advisor.options[0].value).toBe("");
  expect(delegationOptionSelected(advisor, {}, "")).toBe(true);
  expect(crossDelegationSummary(advisor, {})).toBe("Off");
});

it("advisor: picking Off clears a saved advisor and a pick replaces it", () => {
  const advisor = setting(CROSS_ADVISOR_KEY);
  const saved = { [CROSS_ADVISOR_KEY]: encodeAdvisor(ref(codex))! };
  expect(delegationOptionSelected(advisor, saved, saved[CROSS_ADVISOR_KEY])).toBe(true);
  expect(delegationOptionSelected(advisor, saved, "")).toBe(false);
  expect(delegationNextValue(advisor, saved, "")).toBe("");
  expect(delegationNextValue(advisor, saved, encodeAdvisor(ref(cursor))!)).toBe(
    encodeAdvisor(ref(cursor)),
  );
});

it("advisor: the current model is offered, and an unavailable saved advisor stays visible", () => {
  const advisor = setting(CROSS_ADVISOR_KEY);
  expect(advisor.options.map((option) => option.value)).toContain(encodeAdvisor(ref(claude)));
  const gone = encodeAdvisor({ harness: "pi", model: "pi:gone" })!;
  const withGone = crossDelegationSettings({ ...input({ [CROSS_ADVISOR_KEY]: gone }) }).find(
    (item) => item.id === CROSS_ADVISOR_KEY,
  )!;
  expect(withGone.options.map((option) => option.value)).toContain(gone);
  expect(crossDelegationSummary(withGone, { [CROSS_ADVISOR_KEY]: gone })).toBe(
    "Unavailable · Pi · Gone",
  );
});

it("distinguishes Automatic, Off and explicit lists and switches modes without storing a snapshot", () => {
  const automatic = { crossSubagents: "auto" };
  const row = setting(CROSS_SUBAGENTS_KEY, automatic);
  expect(crossDelegationSummary(row, automatic)).toBe("Automatic");
  expect(delegationOptionSelected(row, automatic, "")).toBe(false);
  expect(delegationOptionSelected(row, automatic, "auto")).toBe(true);
  const explicit = delegationNextValue(row, automatic, encodeAdvisor(ref(codex))!);
  expect(decodeSubagents(explicit)).toEqual([ref(codex)]);
  expect(delegationNextValue(row, { crossSubagents: explicit }, "auto")).toBe("auto");
  expect(delegationNextValue(row, automatic, "")).toBe("[]");
  expect(crossDelegationSummary(row, { crossSubagents: "[]" })).toBe("Off");
  renderControl(automatic);
  expect(mode("Automatic").getAttribute("aria-checked")).toBe("true");
  // The resolved models are not listed while Automatic.
  expect(container.querySelector("[data-delegation-model]")).toBeNull();
});

it("names the account on an advisor model that more than one account offers", () => {
  const option = (account: string, model = "Haiku 5.5") => ({
    value: encodeAdvisor({
      harness: "claude",
      model: `claude:${model.toLowerCase()}`,
      providerAccountId: account,
    })!,
    label: `Claude · ${model} · ${account}`,
    modelLabel: model,
  });
  const setting = {
    id: CROSS_ADVISOR_KEY,
    label: "Advisor (any provider)",
    value: "",
    options: [option("work"), option("home"), option("work", "Fable 5.2")],
  } as unknown as ModelSetting;
  const t = (text: string) => text;
  expect(delegationPickerOptions(setting, t).map((option) => option.label)).toEqual([
    "Haiku 5.5 · work",
    "Haiku 5.5 · home",
    "Fable 5.2",
  ]);
});

it("lists every custom subagent inline, each with its own remove action", () => {
  const both = encodeSubagents([ref(codex), ref(cursor)])!;
  const onChange = renderControl({ [CROSS_SUBAGENTS_KEY]: both });
  expect(mode("Custom").getAttribute("aria-checked")).toBe("true");
  const rows = [...container.querySelectorAll("[data-delegation-model]")];
  // Each row names its provider, so the same model from two providers is told apart.
  expect(rows.map((row) => row.textContent)).toEqual([
    `GPT 6.1 Sol${HARNESS_TITLE.codex}`,
    `Composer 2${HARNESS_TITLE.cursor}`,
  ]);
  act(() => button("Remove GPT 6.1 Sol").click());
  expect(decodeSubagents(onChange.mock.lastCall?.[0])).toEqual([ref(cursor)]);
});

it("adds subagents from a picker grouped by provider", () => {
  const one = encodeSubagents([ref(codex)])!;
  const onChange = renderControl({ [CROSS_SUBAGENTS_KEY]: one });
  act(() => button("Add model").click());
  const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
  expect(options.map((option) => option.textContent)).toEqual(
    expect.arrayContaining([
      expect.stringContaining("Sonnet 5"),
      expect.stringContaining("GPT 6.1 Sol"),
      expect.stringContaining("Composer 2"),
    ]),
  );
  expect(document.body.textContent).toContain("Cursor");
  act(() => options.find((option) => option.textContent?.includes("Composer 2"))!.click());
  expect(decodeSubagents(onChange.mock.lastCall?.[0])).toEqual([ref(codex), ref(cursor)]);
});

it("turns subagents Off when the last custom model is removed", () => {
  const onChange = renderControl({ [CROSS_SUBAGENTS_KEY]: encodeSubagents([ref(codex)])! });
  act(() => button("Remove GPT 6.1 Sol").click());
  expect(onChange).toHaveBeenLastCalledWith("[]");
});

it("stores nothing for Custom until a model is picked, and writes Automatic and Off", () => {
  const onChange = renderControl({ [CROSS_SUBAGENTS_KEY]: "auto" });
  act(() => mode("Custom").click());
  expect(onChange).not.toHaveBeenCalled();
  expect(mode("Custom").getAttribute("aria-checked")).toBe("true");
  expect(button("Add model")).toBeDefined();
  act(() => mode("Off").click());
  expect(onChange).toHaveBeenLastCalledWith("[]");
  act(() => mode("Automatic").click());
  expect(onChange).toHaveBeenLastCalledWith("auto");
});

it("image models: a checklist under Custom, Off stores an empty list, Automatic clears it", () => {
  const images: ModelSetting = {
    id: "imageModels",
    label: "Image models",
    kind: "select",
    value: "",
    options: [
      { value: "", label: "Automatic" },
      { value: "codex", label: "Codex ImageGen" },
      { value: "antigravity", label: "Nano Banana (Antigravity)" },
    ],
  };
  const onChange = vi.fn();
  const render = (value: string | undefined) =>
    act(() =>
      root.render(createElement(DelegationSelectionControl, { setting: images, value, onChange })),
    );
  render(undefined);
  expect(mode("Automatic").getAttribute("aria-checked")).toBe("true");
  act(() => mode("Off").click());
  expect(onChange).toHaveBeenLastCalledWith("[]");
  render('["codex"]');
  const boxes = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  expect(boxes.map((box) => box.checked)).toEqual([true, false]);
  act(() => boxes[1]!.click());
  expect(onChange).toHaveBeenLastCalledWith('["codex","antigravity"]');
  act(() => boxes[0]!.click());
  expect(onChange).toHaveBeenLastCalledWith("[]");
  render("[]");
  expect(mode("Off").getAttribute("aria-checked")).toBe("true");
  act(() => mode("Automatic").click());
  expect(onChange).toHaveBeenLastCalledWith("");
});

it("advisor: a switch that starts on the first model and turns off with an empty value", () => {
  const advisor = setting(CROSS_ADVISOR_KEY);
  const onChange = vi.fn();
  const render = (value: string) =>
    act(() => root.render(createElement(AdvisorControl, { setting: advisor, value, onChange })));
  render("");
  const toggle = () => container.querySelector<HTMLButtonElement>('[role="switch"]')!;
  expect(toggle().getAttribute("aria-checked")).toBe("false");
  expect(container.querySelector('[aria-haspopup="dialog"]')).toBeNull();
  act(() => toggle().click());
  expect(onChange).toHaveBeenLastCalledWith(advisor.options[1]!.value);
  render(encodeAdvisor(ref(codex))!);
  expect(toggle().getAttribute("aria-checked")).toBe("true");
  expect(container.querySelector('[aria-haspopup="dialog"]')?.textContent).toContain("GPT 6.1 Sol");
  act(() => toggle().click());
  expect(onChange).toHaveBeenLastCalledWith("");
});
