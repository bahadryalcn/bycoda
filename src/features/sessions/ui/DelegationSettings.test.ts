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
import { DelegationSubagentsControl } from "./DelegationSettings";

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
      createElement(DelegationSubagentsControl, {
        label: "Subagents (any provider)",
        setting: setting(CROSS_SUBAGENTS_KEY, values),
        values,
        disabled: false,
        onChange,
      }),
    ),
  );
  return onChange;
}

function openMenu() {
  act(() => container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click());
  return document.querySelector<HTMLElement>('[role="menu"]')!;
}

function rowFor(menu: HTMLElement, label: string) {
  return [...menu.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')].find(
    (row) => row.getAttribute("aria-label") === label,
  )!;
}

it("summarises the saved subagents: Off, the one model, then the first plus a count", () => {
  const one = { [CROSS_SUBAGENTS_KEY]: encodeSubagents([ref(codex)])! };
  const two = { [CROSS_SUBAGENTS_KEY]: encodeSubagents([ref(codex), ref(cursor)])! };
  expect(crossDelegationSummary(setting(CROSS_SUBAGENTS_KEY), {})).toBe("Off");
  expect(crossDelegationSummary(setting(CROSS_SUBAGENTS_KEY, one), one)).toBe(
    "Codex · GPT 6.1 Sol",
  );
  expect(crossDelegationSummary(setting(CROSS_SUBAGENTS_KEY, two), two)).toBe(
    "Codex · GPT 6.1 Sol +1",
  );
});

it("toggles several subagents in place and writes the encoded list", () => {
  const onChange = renderControl({});
  const menu = openMenu();
  act(() => rowFor(menu, "Codex · GPT 6.1 Sol").click());
  expect(onChange).toHaveBeenLastCalledWith(encodeSubagents([ref(codex)]));

  const first = encodeSubagents([ref(codex)])!;
  renderControl({ [CROSS_SUBAGENTS_KEY]: first }, onChange);
  const stillOpen = document.querySelector<HTMLElement>('[role="menu"]')!;
  act(() => rowFor(stillOpen, "Cursor · Composer 2").click());
  const written = onChange.mock.lastCall?.[0] as string;
  expect(decodeSubagents(written)).toEqual([ref(codex), ref(cursor)]);
  expect(JSON.parse(written)).toEqual([ref(codex), ref(cursor)]);
});

it("removes a picked subagent when it is picked again", () => {
  const both = encodeSubagents([ref(codex), ref(cursor)])!;
  const onChange = renderControl({ [CROSS_SUBAGENTS_KEY]: both });
  const menu = openMenu();
  act(() => rowFor(menu, "Codex · GPT 6.1 Sol").click());
  expect(decodeSubagents(onChange.mock.lastCall?.[0])).toEqual([ref(cursor)]);
});

it("clears every subagent with Off", () => {
  const onChange = renderControl({ [CROSS_SUBAGENTS_KEY]: encodeSubagents([ref(codex)])! });
  const menu = openMenu();
  act(() => rowFor(menu, "Off").click());
  expect(onChange).toHaveBeenLastCalledWith("[]");
});

it("marks the checked rows as checkboxes", () => {
  renderControl({ [CROSS_SUBAGENTS_KEY]: encodeSubagents([ref(cursor)])! });
  const menu = openMenu();
  expect(rowFor(menu, "Cursor · Composer 2").getAttribute("aria-checked")).toBe("true");
  expect(rowFor(menu, "Codex · GPT 6.1 Sol").getAttribute("aria-checked")).toBe("false");
  expect(rowFor(menu, "Off").getAttribute("aria-checked")).toBe("false");
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

it("moves focus with the arrow keys and picks the focused row", () => {
  const onChange = renderControl({});
  const menu = openMenu();
  const off = rowFor(menu, "Off");
  expect(document.activeElement).toBe(off);
  act(() => {
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  act(() => {
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  // The first model row after Automatic is the current model: subagents may include it.
  const claudeRow = rowFor(menu, "Claude Code · Sonnet 5");
  expect(document.activeElement).toBe(claudeRow);
  act(() => (document.activeElement as HTMLElement).click());
  expect(decodeSubagents(onChange.mock.lastCall?.[0])).toEqual([ref(claude)]);
});

it("closes on Escape without changing the value", () => {
  const onChange = renderControl({});
  const menu = openMenu();
  act(() => {
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(onChange).not.toHaveBeenCalled();
  expect(document.querySelector('[role="menu"]')).toBeNull();
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

it("shows the automatic wand in an image-model field and its menu", () => {
  const imageSetting: ModelSetting = {
    id: "imageModels",
    label: "Image models",
    kind: "select",
    value: "",
    options: [{ value: "", label: "Automatic" }],
  };
  act(() =>
    root.render(
      createElement(DelegationSubagentsControl, {
        label: "Image models",
        setting: imageSetting,
        values: {},
        disabled: false,
        appearance: "field",
        onChange: vi.fn(),
      }),
    ),
  );
  expect(container.querySelector("button .lucide-wand-sparkles")).not.toBeNull();
  expect(openMenu().querySelector(".lucide-wand-sparkles")).not.toBeNull();
});

it("keeps explicit Off distinct from Automatic", () => {
  renderControl({});
  expect(rowFor(openMenu(), "Off").querySelector(".lucide-wand-sparkles")).toBeNull();
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
  expect(container.textContent).toContain("Automatic");
  expect(container.querySelector('[data-tone="accent"]')).not.toBeNull();
  // The resolved models are not listed: the badge alone says Automatic.
  expect(container.textContent).not.toContain("Strong");
});
