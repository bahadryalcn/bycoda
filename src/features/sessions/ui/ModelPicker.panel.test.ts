// @vitest-environment happy-dom
import { act, createElement, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../integrations/harness/core/availability", () => ({
  getHarnessAvailabilitySnapshot: () => 0,
  hasProbedHarnessAvailability: () => true,
  isHarnessAvailable: () => true,
  probeHarnessAvailability: () => Promise.resolve(),
  subscribeHarnessAvailability: () => () => undefined,
}));

vi.mock("../../../integrations/harness/core/registry", () => ({
  refreshHarnessCatalogs: () => Promise.resolve(),
}));

vi.mock("../../../shared/ui/Popover", async () => ({
  ...(await vi.importActual<typeof import("../../../shared/ui/Popover")>(
    "../../../shared/ui/Popover",
  )),
  Popover: ({
    children,
    role,
    kind,
    className,
    tabIndex,
    onKeyDown,
    ...props
  }: {
    children: ReactNode;
    role?: string;
    kind?: string;
    className?: string;
    tabIndex?: number;
    onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
    maxHeight?: number;
    style?: CSSProperties;
    side?: string;
    "aria-label"?: string;
    "data-model-panel"?: boolean;
  }) =>
    createElement(
      "div",
      {
        role: kind === "dialog" ? "dialog" : role,
        className,
        tabIndex,
        onKeyDown,
        style: props.style,
        "data-max-height": props.maxHeight,
        "data-side": props.side,
        "aria-label": props["aria-label"],
        "data-model-panel": props["data-model-panel"] ? "" : undefined,
      },
      children,
    ),
}));

import { ModelPicker, preloadModelPicker } from "./ModelPicker";
import { renameProviderAccount, saveProviderAccount } from "../../providers/model/providerAccounts";
import { resetDisabledModels, resetHarnessModelOverlays, setHarnessModels } from "../model/models";
import { KEYBINDINGS, saveKeybindingOverride } from "../../settings/model/settings";
import { ModelSettingHelp, ModelSettingsColumn } from "./ModelSettingsColumn";
import type { ModelSetting } from "../model/models";
import { delegationNextValue } from "../model/crossDelegation";
import { encodeAdvisor } from "../../../shared/model/host-contracts/delegation";
import { withAutoCompactSettings } from "../model/autoCompact";
import { CLAUDE_COMPACT_SETTINGS } from "../model/claudeCompact";

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  await preloadModelPicker();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  resetDisabledModels();
  resetHarnessModelOverlays();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  resetHarnessModelOverlays();
  container.remove();
  vi.unstubAllGlobals();
});

const PANEL = '[role="dialog"][aria-label="Model and settings"][data-model-panel]';
type PickerProps = Parameters<typeof ModelPicker>[0];

async function render(props: Partial<PickerProps> & Pick<PickerProps, "harness" | "model">) {
  await act(async () =>
    root.render(
      createElement(ModelPicker, {
        values: {},
        onChange: vi.fn(),
        onSettingsChange: vi.fn(),
        ...props,
      }),
    ),
  );
}

const trigger = () => container.querySelector<HTMLButtonElement>("button")!;
const panel = () => container.querySelector<HTMLElement>(PANEL);

async function openPanel() {
  await act(async () => trigger().click());
  return panel()!;
}

async function click(element: Element) {
  await act(async () => (element as HTMLElement).click());
}

async function key(element: EventTarget, value: string) {
  await act(async () => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }),
    );
  });
}

async function movePointer(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, movementX: 1 }));
  });
}

async function inputText(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const listbox = () => panel()!.querySelector<HTMLElement>('[role="listbox"]')!;
const providerTab = (label: string) =>
  panel()!.querySelector<HTMLButtonElement>(
    `[role="tablist"][aria-label="Providers"] [role="tab"][aria-label="${label}"]`,
  )!;

/** A setting block, switching to the column tab that holds it when needed. */
async function settingBlock(id: string) {
  const find = () =>
    container.querySelector<HTMLElement>(`[data-model-settings] [data-setting-id="${id}"]`);
  if (find()) return find()!;
  for (const tab of container.querySelectorAll<HTMLButtonElement>(
    '[data-model-settings] [role="tab"]',
  )) {
    await click(tab);
    if (find()) return find()!;
  }
  throw new Error(`No setting block ${id}`);
}

const optionByText = (scope: Element, role: string, text: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>(`[role="${role}"]`)].find(
    (item) => item.textContent?.trim() === text,
  )!;

const columnLabels = () =>
  [...container.querySelectorAll<HTMLElement>("[data-model-settings] [data-setting-id]")].map(
    (block) =>
      (block.querySelector("[data-setting-label]") ?? block.querySelector("span"))?.textContent ??
      "",
  );

describe("model panel", () => {
  it("honours rebound, disabled, repeat and inactive shortcuts", async () => {
    saveKeybindingOverride("App: Switch Model", { shortcut: "Control+KeyM" });
    await render({ harness: "claude", model: "claude:opus-5", hotkeys: false });
    const press = async (repeat = false) =>
      act(async () => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "m",
            code: "KeyM",
            ctrlKey: true,
            bubbles: true,
            repeat,
          }),
        );
      });
    await press();
    expect(panel()).toBeNull();
    await render({ harness: "claude", model: "claude:opus-5", hotkeys: true });
    await press(true);
    expect(panel()).toBeNull();
    await press();
    expect(panel()).not.toBeNull();
    await key(window, "Escape");
    expect(document.activeElement).toBe(trigger());
    saveKeybindingOverride("App: Switch Model", { disabled: true });
    await press();
    expect(panel()).toBeNull();
  });

  it("opens with semantic click, filters and selects models with search keys", async () => {
    setHarnessModels("cursor", [
      { id: "cursor:one", nativeId: "one", harness: "cursor", name: "One" },
      { id: "cursor:two", nativeId: "two", harness: "cursor", name: "Two" },
    ]);
    const onChange = vi.fn();
    await render({ harness: "cursor", model: "cursor:one", onChange });
    // HTMLElement.click() carries no pointerdown/mousedown and detail is zero, as with Invoke.
    await openPanel();
    expect(trigger().tagName).toBe("BUTTON");
    expect(trigger().type).toBe("button");
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    const search = document.activeElement as HTMLInputElement;
    await key(search, "ArrowDown");
    await key(search, "Enter");
    expect(onChange).toHaveBeenLastCalledWith("cursor", "cursor:two");
    await inputText(search, "One");
    expect(listbox().querySelectorAll('[role="option"]')).toHaveLength(1);
    await key(search, "ArrowUp");
    await key(search, "Enter");
    expect(onChange).toHaveBeenLastCalledWith("cursor", "cursor:one");
    await key(window, "Escape");
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });
  it("toggles the full panel with the registered shortcut and returns focus", async () => {
    const binding = KEYBINDINGS.find((row) => row.command === "App: Switch Model")!;
    expect(KEYBINDINGS.filter((row) => row.keys === binding.keys)).toHaveLength(1);
    await render({ harness: "claude", model: "claude:opus-5", hotkeys: true });
    const press = async () =>
      act(async () => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: ">",
            code: "Period",
            ctrlKey: true,
            shiftKey: true,
            bubbles: true,
          }),
        );
      });
    await press();
    expect(panel()).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new Event("open_model_picker"));
    });
    expect(panel()).not.toBeNull();
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Search models");
    await new Promise((resolve) => setTimeout(resolve, 85));
    await press();
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it.each([
    ["subagentModel", "default", "subagentPolicy"],
    ["autoCompact", "off", "autoCompactWindow"],
  ])("locks %s dependent settings until their parent is enabled", async (parent, value, child) => {
    setHarnessModels("cursor", [
      {
        id: "cursor:dependent",
        harness: "cursor",
        name: "Dependent",
        nativeId: "dependent",
        settings: [
          {
            id: parent,
            label: "Parent",
            kind: "select",
            value,
            options: [
              { value, label: "Default" },
              { value: "enabled", label: "Enabled" },
            ],
          },
          {
            id: child,
            label: "Child",
            kind: "select",
            value: "default",
            options: [
              { value: "default", label: "Default" },
              { value: "custom", label: "Custom" },
            ],
          },
        ],
      },
    ]);
    const onSettingsChange = vi.fn();
    await render({ harness: "cursor", model: "cursor:dependent", onSettingsChange });
    await openPanel();
    const locked = optionByText(await settingBlock(child), "radio", "Custom");
    expect(locked.disabled).toBe(true);
    await click(locked);
    expect(onSettingsChange).not.toHaveBeenCalled();

    await render({
      harness: "cursor",
      model: "cursor:dependent",
      values: { [parent]: "enabled" },
      onSettingsChange,
    });
    const custom = optionByText(await settingBlock(child), "radio", "Custom");
    expect(custom.disabled).toBe(false);
    await click(custom);
    expect(onSettingsChange).toHaveBeenCalledWith({ [parent]: "enabled", [child]: "custom" });
    expect(panel()).not.toBeNull();
  });

  it("lists a long short-choice such as the subagent policy inline, not behind a picker", async () => {
    setHarnessModels("cursor", [
      {
        id: "cursor:policy",
        harness: "cursor",
        name: "Policy",
        nativeId: "policy",
        settings: [
          {
            id: "subagentModel",
            label: "Subagent model",
            kind: "select",
            value: "default",
            options: [
              { value: "default", label: "Default" },
              { value: "enabled", label: "Enabled" },
            ],
          },
          {
            id: "subagentPolicy",
            label: "Subagent model policy",
            kind: "select",
            value: "fallback",
            options: [
              { value: "fallback", label: "Default" },
              { value: "force", label: "Apply to all" },
            ],
          },
        ],
      },
    ]);
    const onSettingsChange = vi.fn();
    await render({
      harness: "cursor",
      model: "cursor:policy",
      values: { subagentModel: "enabled" },
      onSettingsChange,
    });
    await openPanel();
    const block = await settingBlock("subagentPolicy");
    expect(block.querySelector("[aria-haspopup]")).toBeNull();
    expect(optionByText(block, "radio", "Default").getAttribute("aria-checked")).toBe("true");
    await click(optionByText(block, "radio", "Apply to all"));
    expect(onSettingsChange).toHaveBeenCalledWith({
      subagentModel: "enabled",
      subagentPolicy: "force",
    });
  });

  it("focuses a visible model search after its first frame", async () => {
    setHarnessModels("cursor", [
      {
        id: "cursor:focus",
        harness: "cursor",
        name: "Focus model",
        nativeId: "focus",
        settings: [],
      },
    ]);
    await render({ harness: "cursor", model: "cursor:focus" });
    await openPanel();
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    const search = container.querySelector<HTMLInputElement>('input[aria-label="Search models"]');
    expect(search).not.toBeNull();
    expect(document.activeElement).toBe(search);
    // The input owns the listbox: it names it, and points at the highlighted option.
    expect(search!.getAttribute("role")).toBe("combobox");
    expect(search!.getAttribute("aria-controls")).toBe(listbox().id);
    const option = listbox().querySelector<HTMLElement>('[role="option"]')!;
    expect(search!.getAttribute("aria-activedescendant")).toBe(option.id);
  });

  it("opens one fixed-size panel with only the visible providers in its rail", async () => {
    await render({
      harness: "claude",
      model: "claude:opus-5",
      allowedHarnesses: ["claude", "codex", "grok"],
    });
    const frame = await openPanel();
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    // Favorites plus the three allowed providers.
    expect(
      frame.querySelectorAll('[role="tablist"][aria-label="Providers"] [role="tab"]'),
    ).toHaveLength(4);
    expect(frame.style.getPropertyValue("--layout-height")).toBe("460px");
    expect(frame.className).toContain("[height:var(--layout-height)]");
    expect(frame.dataset.maxHeight).toBe("460");
    expect(frame.dataset.side).toBe("top");
    expect(frame.querySelector("[data-model-settings]")).not.toBeNull();
    expect(frame.querySelector("[data-model-setting-help]")).not.toBeNull();
  });

  it("shows the model name and effort in the trigger and edits effort inline", async () => {
    const onChange = vi.fn();
    const onSettingsChange = vi.fn();
    await render({
      harness: "grok",
      model: "grok:grok-4.6",
      values: { effort: "high" },
      onChange,
      onSettingsChange,
    });
    expect(trigger().textContent).toBe("Grok 4.6High");
    expect(trigger().getAttribute("aria-label")).toBe("Grok Build Grok 4.6, effort High");
    expect(trigger().querySelector("[data-model-effort]")?.textContent).toBe("High");
    expect(trigger().querySelector("svg")).not.toBeNull();

    await openPanel();
    expect(container.querySelector('[role="tablist"][aria-orientation="vertical"]')).not.toBeNull();
    expect(providerTab("Favorites")).not.toBeNull();
    expect(providerTab("Antigravity")).not.toBeNull();
    const grokTab = providerTab("Grok Build");
    expect(grokTab.className).toContain("bycoda-arc");
    expect(grokTab.className).not.toContain("transition");
    await movePointer(grokTab);
    expect(grokTab.getAttribute("aria-selected")).toBe("true");
    expect(
      [...listbox().querySelectorAll('[role="option"]')].some(
        (option) => option.textContent === "Grok 4.6",
      ),
    ).toBe(true);
    const selectedRow = listbox().querySelector(
      '[role="option"][aria-selected="true"]',
    )!.parentElement!;
    expect(selectedRow.querySelector('button[aria-label="Add to favorites"]')!.className).toContain(
      "bycoda-arc",
    );
    expect(selectedRow.lastElementChild?.querySelector("svg")).not.toBeNull();
    const unselectedRow = listbox().querySelector(
      '[role="option"][aria-selected="false"]',
    )!.parentElement!;
    expect(
      unselectedRow.querySelector("[data-picker-actions] button")?.getAttribute("aria-label"),
    ).toBe("Add to favorites");

    const settings = container.querySelector("[data-model-settings]")!;
    await click(settings.querySelector('[role="radio"][aria-label="Extra High"]')!);
    expect(onSettingsChange).toHaveBeenCalledWith({ effort: "xhigh" });
    expect(onChange).not.toHaveBeenCalled();
    expect(panel()).not.toBeNull();
  });

  it("groups OpenCode models by provider and searches provider names", async () => {
    setHarnessModels("opencode", [
      {
        id: "opencode:opencode-go/gpt-5.6-luna",
        harness: "opencode",
        name: "GPT-5.6 Luna",
        nativeId: "opencode-go/gpt-5.6-luna",
        provider: { id: "opencode-go", name: "OpenCode Go" },
      },
      {
        id: "opencode:openai/gpt-5.6-luna",
        harness: "opencode",
        name: "GPT-5.6 Luna",
        nativeId: "openai/gpt-5.6-luna",
        provider: { id: "openai", name: "OpenAI" },
      },
      {
        id: "opencode:openai/gpt-5.6-luna-fast",
        harness: "opencode",
        name: "GPT-5.6 Luna Fast",
        nativeId: "openai/gpt-5.6-luna-fast",
        provider: { id: "openai", name: "OpenAI" },
      },
    ]);
    await render({ harness: "opencode", model: "opencode:opencode-go/gpt-5.6-luna" });
    expect(trigger().getAttribute("aria-label")).toBe("OpenCode, OpenCode Go, GPT-5.6 Luna");
    await openPanel();
    const groups = () =>
      [...listbox().querySelectorAll('[role="group"]')].map(
        (group) => document.getElementById(group.getAttribute("aria-labelledby")!)?.textContent,
      );
    expect(groups()).toEqual(["OpenCode Go", "OpenAI"]);
    expect(listbox().querySelector('[role="group"]')?.textContent).toContain("GPT-5.6 Luna");
    expect(
      [...listbox().querySelectorAll('[role="option"]')].find((option) =>
        option.textContent?.includes("GPT-5.6 Luna"),
      ),
    ).not.toBeNull();
    expect(listbox().querySelectorAll('[role="group"]')[1]?.textContent).toContain(
      "GPT-5.6 Luna Fast",
    );
    await inputText(
      container.querySelector<HTMLInputElement>('input[aria-label="Search models"]')!,
      "OpenAI",
    );
    expect(groups()).toEqual(["OpenAI"]);
    expect(listbox().querySelectorAll('[role="option"]')).toHaveLength(2);
  });

  it("names the source of same-name favorites from different providers", async () => {
    setHarnessModels("cursor", [
      { id: "cursor:auto", harness: "cursor", name: "Auto", nativeId: "auto" },
      {
        id: "cursor:muse-spark-1.3",
        harness: "cursor",
        name: "Muse Spark 1.3",
        nativeId: "muse-spark-1.3",
      },
    ]);
    setHarnessModels("opencode", [
      {
        id: "opencode:opencode-go/muse-spark-1.3",
        harness: "opencode",
        name: "Muse Spark 1.3",
        nativeId: "opencode-go/muse-spark-1.3",
        provider: { id: "opencode-go", name: "OpenCode Go" },
      },
    ]);
    localStorage.setItem(
      "bycoda.favoriteModels",
      JSON.stringify([
        "cursor:auto",
        "cursor:muse-spark-1.3",
        "opencode:opencode-go/muse-spark-1.3",
      ]),
    );
    await render({ harness: "cursor", model: "cursor:auto" });
    await openPanel();
    await click(providerTab("Favorites"));
    expect(
      [...listbox().querySelectorAll('[role="option"]')].map((option) =>
        option.textContent?.trim().replace(/\s+(Cursor|OpenCode Go)$/, ", $1"),
      ),
    ).toEqual(["Auto, Cursor", "Muse Spark 1.3, Cursor", "Muse Spark 1.3, OpenCode Go"]);
  });

  it("keeps all consequential effort options as named inline choices", async () => {
    setHarnessModels("codex", [
      {
        id: "codex:gpt-5.6",
        harness: "codex",
        name: "GPT-5.6",
        nativeId: "gpt-5.6",
        settings: [
          {
            id: "reasoningEffort",
            label: "Reasoning",
            kind: "select",
            value: "high",
            options: [
              { value: "low", label: "Low" },
              { value: "high", label: "High" },
              { value: "max", label: "Max" },
              { value: "ultra", label: "Ultra" },
            ],
          },
        ],
      },
    ]);
    await render({ harness: "codex", model: "codex:gpt-5.6", values: { reasoningEffort: "high" } });
    await openPanel();
    const block = await settingBlock("reasoningEffort");
    expect(block.querySelectorAll('[role="radio"]')).toHaveLength(4);
    expect(
      [...block.querySelectorAll('[role="radio"]')].map((radio) =>
        radio.getAttribute("aria-label"),
      ),
    ).toEqual(["Low", "High", "Max", "Ultra"]);
    expect(
      block.querySelector('[role="radio"][aria-checked="true"]')?.getAttribute("aria-label"),
    ).toBe("High");
  });

  it("returns to the selected model's harness when reopened", async () => {
    await render({ harness: "grok", model: "grok:grok-4.6", values: { effort: "high" } });
    await openPanel();
    const openCodeTab = providerTab("OpenCode");
    expect(openCodeTab.getAttribute("aria-selected")).toBe("false");
    await movePointer(openCodeTab);
    expect(openCodeTab.getAttribute("aria-selected")).toBe("true");

    await act(async () => trigger().click());
    expect(panel()).toBeNull();
    await openPanel();
    expect(providerTab("Grok Build").getAttribute("aria-selected")).toBe("true");
  });
});

describe("model panel settings column", () => {
  it("does not open empty help when no setting has a description", async () => {
    await act(async () => root.render(createElement(ModelSettingHelp, { setting: null })));
    expect(container.querySelector('button[aria-haspopup="dialog"]')).toBeNull();
  });
  it("operates Subagents modes, Custom search, Done, chips and Add with keyboard focus", async () => {
    const choice = encodeAdvisor({ harness: "codex", model: "codex:one" })!;
    const setting: ModelSetting = {
      id: "crossSubagents",
      label: "Subagents",
      kind: "select",
      value: "auto",
      options: [
        { value: "auto", label: "Automatic" },
        { value: "", label: "Off" },
        { value: choice, label: "Codex · One" },
      ],
    };
    function ControlledColumn() {
      const [values, setValues] = useState<Record<string, string>>({});
      return createElement(ModelSettingsColumn, {
        current: { id: "codex:one", harness: "codex", name: "One" },
        settings: [setting],
        values,
        locked: () => false,
        onExplain: vi.fn(),
        onChoose: (selected, value) =>
          setValues({
            [selected.id]: delegationNextValue(selected, values, value) || "[]",
          }),
      });
    }
    await act(async () => root.render(createElement(ControlledColumn)));
    const radio = (text: string) => optionByText(container, "radio", text);
    const picker = () => container.querySelector("[data-model-setting-picker]");
    expect(radio("Automatic").getAttribute("aria-checked")).toBe("true");
    await act(async () => radio("Automatic").focus());
    await key(radio("Automatic"), "End");
    expect(radio("Off").getAttribute("aria-checked")).toBe("true");
    await key(radio("Off"), "Home");
    expect(radio("Automatic").getAttribute("aria-checked")).toBe("true");
    await key(radio("Automatic"), "ArrowRight");
    expect(picker()).not.toBeNull();
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    const search = document.activeElement as HTMLInputElement;
    expect(search.getAttribute("aria-label")).toBe("Search models");
    await inputText(search, "One");
    await key(search, "Enter");
    expect(picker()!.querySelector('[role="option"]')?.getAttribute("aria-selected")).toBe("true");
    const done = [...picker()!.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent === "Done",
    )!;
    await act(async () => done.focus());
    // Semantic button activation, without pointer events.
    await click(done);
    expect(picker()).toBeNull();
    expect(document.activeElement).toBe(radio("Custom"));
    const remove = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove Codex · One"]',
    )!;
    expect(remove.disabled).toBe(false);
    await act(async () => remove.focus());
    await click(remove);
    expect(radio("Off").getAttribute("aria-checked")).toBe("true");
    await key(radio("Off"), "ArrowLeft");
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    await inputText(document.activeElement as HTMLInputElement, "One");
    await key(document.activeElement!, "Enter");
    await click(
      [...picker()!.querySelectorAll<HTMLButtonElement>("button")].find(
        (item) => item.textContent === "Done",
      )!,
    );
    const add = container.querySelector<HTMLButtonElement>("[data-model-setting-add]")!;
    await act(async () => add.focus());
    await click(add);
    expect(picker()).not.toBeNull();
  });

  const sel = (id: string, label: string, value: string, options: string[]) => ({
    id,
    label,
    kind: "select" as const,
    value,
    options: options.map((option) => ({ value: option, label: option })),
  });

  async function openOrdered(values: Record<string, string>, onSettingsChange = vi.fn()) {
    setHarnessModels("cursor", [
      {
        id: "cursor:ordered",
        harness: "cursor",
        name: "Ordered",
        nativeId: "ordered",
        // Catalog order is deliberately scrambled: the panel must not follow it.
        settings: [
          sel("subagentModel", "Subagent model", "default", ["default", "other"]),
          sel("autoCompactWindow", "Auto-compact window", "200k", ["200k", "400k"]),
          {
            id: "fast",
            label: "Fast",
            kind: "toggle",
            value: "false",
            options: [
              { value: "true", label: "On" },
              { value: "false", label: "Off" },
            ],
          },
          sel("advisor", "Advisor", "off", ["off", "on"]),
          sel("effort", "Reasoning", "low", ["low", "high"]),
          sel("autoCompact", "Auto-compact", "on", ["on", "off"]),
        ],
      },
    ]);
    await render({
      harness: "cursor",
      model: "cursor:ordered",
      values,
      showEffortSummary: true,
      onSettingsChange,
    });
    return openPanel();
  }

  it("switches Settings/Agents and provider tabs with arrows and explains focused controls", async () => {
    await openOrdered({});
    const settingTab = container.querySelector<HTMLElement>('[data-model-settings] [role="tab"]')!;
    await act(async () => settingTab.focus());
    await key(settingTab, "ArrowRight");
    expect(document.activeElement?.textContent).toBe("Agents");
    expect(columnLabels()).toContain("Subagents");
    await key(document.activeElement!, "ArrowLeft");
    expect(document.activeElement?.textContent).toBe("Settings");
    const effort = container.querySelector<HTMLElement>(
      '[data-setting-id="effort"] [role="radio"]',
    )!;
    await act(async () => effort.focus());
    const help = () => container.querySelector("[data-model-setting-help]")!.textContent;
    expect(help()).toContain("How long the model thinks");
    await act(async () => effort.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })));
    expect(help()).toContain("How long the model thinks");
    await key(effort, "ArrowRight");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("high");
    const rail = providerTab("Cursor");
    await act(async () => rail.focus());
    await key(rail, "Home");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Favorites");
    expect(help()).not.toContain("How long the model thinks");
  });

  it("lists model and context settings under Settings and delegation under Agents", async () => {
    await openOrdered({});
    const tabs = [...container.querySelectorAll('[data-model-settings] [role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Settings", "Agents"]);
    // Reasoning leads; a dependent setting follows its parent.
    expect(columnLabels()).toEqual(["Reasoning", "Fast", "Auto-compact", "Auto-compact window"]);
    await click(tabs[1]);
    expect(columnLabels()).toEqual(["Advisor", "Image models", "Subagents", "Subagent max effort"]);
    const rows = [...container.querySelectorAll("[data-model-settings] [data-setting-id]")];
    expect(new Set(rows.map((row) => row.parentElement)).size).toBe(1);
  });

  it("toggles Fast with its switch and shows it in the trigger", async () => {
    const onSettingsChange = vi.fn();
    await openOrdered({}, onSettingsChange);
    const fast = container.querySelector<HTMLButtonElement>(
      '[data-setting-id="fast"] [role="switch"][aria-label="Fast"]',
    )!;
    expect(fast.getAttribute("aria-checked")).toBe("false");
    await click(fast);
    expect(onSettingsChange).toHaveBeenCalledWith({ fast: "true" });
    expect(panel()).not.toBeNull();
    expect(container.querySelector("[data-model-fast]")).toBeNull();

    await render({
      harness: "cursor",
      model: "cursor:ordered",
      values: { fast: "true" },
      showEffortSummary: true,
      onSettingsChange,
    });
    expect(container.querySelector("[data-model-fast]")).not.toBeNull();
    expect(trigger().getAttribute("aria-label")).toContain("Fast");
  });

  it.each(["codex", "claude"] as const)(
    "adjusts %s compaction in 50K steps and restores Default",
    async (harness) => {
      const model = withAutoCompactSettings({
        id: `${harness}:compact`,
        name: "Compact",
        harness,
        contextWindow: 400_000,
        settings: harness === "claude" ? CLAUDE_COMPACT_SETTINGS : [],
      });
      const change = vi.fn();
      function Controls() {
        const [values, setValues] = useState<Record<string, string>>({
          autoCompactWindow: "200000",
        });
        return createElement(ModelSettingsColumn, {
          current: model,
          settings: model.settings!,
          values,
          locked: () => false,
          onExplain: () => undefined,
          onChoose: (setting, value) => {
            change(value);
            setValues((previous) => ({ ...previous, [setting.id]: value }));
          },
        });
      }
      await act(async () => root.render(createElement(Controls)));
      const slider = container.querySelector<HTMLElement>('[role="slider"]')!;
      await key(slider, "ArrowRight");
      expect(change).toHaveBeenLastCalledWith("250000");
      expect(slider.getAttribute("aria-valuetext")).toBe("250K");
      await key(slider, "ArrowLeft");
      expect(change).toHaveBeenLastCalledWith("200000");
      await key(slider, "Home");
      expect(change).toHaveBeenLastCalledWith("default");
      expect(slider.getAttribute("aria-valuetext")).toBe("Default");
      await key(slider, "ArrowRight");
      expect(change).toHaveBeenLastCalledWith(harness === "codex" ? "50000" : "100000");
      await key(slider, "End");
      expect(change).toHaveBeenLastCalledWith(harness === "codex" ? "400000" : "1000000");
    },
  );

  it("marks the selected reasoning level and names it above the bars", async () => {
    await openOrdered({ effort: "high" });
    const block = await settingBlock("effort");
    const checked = block.querySelectorAll('[role="radio"][aria-checked="true"]');
    expect(checked).toHaveLength(1);
    expect(checked[0].getAttribute("aria-label")).toBe("high");
    expect(block.firstElementChild?.textContent).toContain("high");
  });

  it("separates automatic subagent effort from real levels and preserves manual choice", async () => {
    const change = vi.fn();
    await openOrdered({ crossSubagentMaxEffort: "high" }, change);
    let block = await settingBlock("crossSubagentMaxEffort");
    expect(
      [...block.querySelectorAll('[role="radio"]')].map((el) => el.getAttribute("aria-label")),
    ).toEqual(["Low", "Medium", "High", "Xhigh", "Max", "Ultra"]);
    const automatic = () => block.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(automatic().getAttribute("aria-checked")).toBe("false");
    await click(automatic());
    expect(change).toHaveBeenLastCalledWith({ crossSubagentMaxEffort: "" });
    await render({
      harness: "cursor",
      model: "cursor:ordered",
      values: { crossSubagentMaxEffort: "" },
      onSettingsChange: change,
    });
    block = await settingBlock("crossSubagentMaxEffort");
    expect(automatic().getAttribute("aria-checked")).toBe("true");
    expect(block.textContent).toContain("No limit");
    expect(block.querySelector('[role="radio"][aria-checked="true"]')).toBeNull();
    await click(automatic());
    expect(change).toHaveBeenLastCalledWith({ crossSubagentMaxEffort: "high" });
  });

  it("explains the hovered setting in the help strip", async () => {
    await openOrdered({});
    const help = () => container.querySelector("[data-model-setting-help]")!.textContent;
    expect(help()).toContain("Help");
    await act(async () => {
      container
        .querySelector('[data-setting-id="fast"] [role="switch"]')!
        .dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(help()).toContain("Same model, faster output");
  });

  it("opens complete settings help without hovering and retains it when focus moves into help", async () => {
    await openOrdered({});
    const footer = container.querySelector("[data-model-setting-help]")!;
    const help = footer.querySelector<HTMLButtonElement>('button[aria-label="Help"]')!;
    expect(help).not.toBeNull();
    await act(async () => help.focus());
    await click(help);
    const descriptions = footer.querySelector('[role="dialog"]')!;
    expect(descriptions).not.toBeNull();
    expect(descriptions.textContent).toContain("How long the model thinks");
    expect(descriptions.textContent).toContain("Same model, faster output");
    expect(help.getAttribute("aria-expanded")).toBe("true");
  });

  it("renders the field presentation as a full-width trigger that opens below", async () => {
    await openOrdered({});
    expect(trigger().getAttribute("data-model-picker-presentation")).toBe("inline");
    expect(trigger().classList.contains("bycoda-arc-select")).toBe(false);
    await render({ harness: "cursor", model: "cursor:ordered", presentation: "field" });
    expect(trigger().getAttribute("data-model-picker-presentation")).toBe("field");
    expect(trigger().classList.contains("bycoda-arc-select")).toBe(true);
    await act(async () => trigger().click());
    await act(async () => trigger().click());
    expect(panel()!.dataset.side).toBe("bottom");
  });

  it("offers a labelled inherit choice that maps to the owner's empty value", async () => {
    setHarnessModels("cursor", [
      {
        id: "cursor:ordered",
        harness: "cursor",
        name: "Ordered",
        nativeId: "ordered",
        settings: [sel("effort", "Reasoning", "low", ["low", "high"])],
      },
    ]);
    const onSelect = vi.fn();
    const onChange = vi.fn();
    const renderInherit = (selected: boolean) =>
      render({
        harness: "cursor",
        model: "cursor:ordered",
        inheritChoice: { label: "Use the global agent", selected, onSelect },
        onChange,
      });
    await renderInherit(true);
    expect(trigger().textContent).toContain("Use the global agent");
    expect(trigger().getAttribute("aria-label")).toBe("Use the global agent");
    await openPanel();
    const inherit = panel()!.querySelector<HTMLButtonElement>("[data-model-inherit-choice]")!;
    expect(inherit.hasAttribute("data-model-inherit-choice")).toBe(true);
    expect(inherit.textContent).toBe("Use the global agent");
    expect(inherit.getAttribute("aria-pressed")).toBe("true");
    // Inherited: no model options to edit.
    expect(container.querySelector("[data-model-settings]")).toBeNull();
    await click(inherit);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(panel()).toBeNull();

    await renderInherit(false);
    await openPanel();
    expect(
      panel()!.querySelector("[data-model-inherit-choice]")!.getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      container.querySelector('[data-model-settings] [data-setting-id="effort"]'),
    ).not.toBeNull();
  });
});

describe("model panel accounts", () => {
  const seedClaude = () =>
    setHarnessModels("claude", [
      { id: "claude:opus-5.5", harness: "claude", name: "Opus 5.5", nativeId: "opus-5.5" },
      { id: "claude:sonnet-5", harness: "claude", name: "Sonnet 5", nativeId: "sonnet-5" },
    ]);
  const addClaudeAccounts = (labels: string[]) => {
    renameProviderAccount("claude", "default", "personal");
    for (const label of labels)
      saveProviderAccount({ id: `account-${label}`, provider: "claude", label });
  };
  const openClaude = async (onChange = vi.fn(), accountId?: string) => {
    seedClaude();
    await render({
      harness: "claude",
      model: "claude:opus-5.5",
      accountChoices: true,
      accountId,
      onChange,
    });
    return openPanel();
  };
  const accountSwitch = () =>
    panel()!.querySelector<HTMLElement>('[role="radiogroup"][aria-label="Account"]');
  const accountMenu = () => panel()!.querySelector<HTMLButtonElement>("[data-model-account-menu]");
  const accountList = () => panel()!.querySelector<HTMLElement>("[data-model-account-list]");
  const accountSearch = () =>
    panel()!.querySelector<HTMLInputElement>('input[aria-label="Find account"]');
  /** Account rows by label; a row's detail line (usage or status) follows the label. */
  const accountRows = () => [
    ...accountList()!.querySelectorAll<HTMLButtonElement>('[role="radiogroup"] [role="radio"]'),
  ];
  const accountLabel = (row: Element) => row.querySelector("span > span")?.textContent;
  const accountRow = (label: string) => accountRows().find((row) => accountLabel(row) === label)!;

  it("names a lone account without a switch or menu", async () => {
    await openClaude();
    expect(panel()!.querySelector("[data-model-account-label]")).not.toBeNull();
    expect(accountSwitch()).toBeNull();
    expect(accountMenu()).toBeNull();
  });

  it("switches between two accounts in one click and lists each model once", async () => {
    addClaudeAccounts(["work"]);
    const onChange = vi.fn();
    await openClaude(onChange);
    expect(
      [...listbox().querySelectorAll('[role="option"]')].map((option) =>
        option.textContent?.trim(),
      ),
    ).toEqual(["Opus 5.5", "Sonnet 5"]);
    const radios = [...accountSwitch()!.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(radios.map((radio) => radio.textContent?.trim())).toEqual(["personal", "work"]);
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
    await click(radios[1]);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("claude", "claude:opus-5.5", "account-work");
    expect(panel()).not.toBeNull();
  });

  it("opens an unsearchable account list for three to five accounts", async () => {
    addClaudeAccounts(["work", "lab"]);
    const onChange = vi.fn();
    await openClaude(onChange);
    expect(accountSwitch()).toBeNull();
    await click(accountMenu()!);
    expect(accountMenu()!.getAttribute("aria-expanded")).toBe("true");
    expect(accountList()).not.toBeNull();
    expect(panel()!.querySelector('[role="listbox"]')).toBeNull();
    expect(accountSearch()).toBeNull();
    expect(accountRows().map(accountLabel)).toEqual(["personal", "work", "lab"]);
    await click(accountRow("lab"));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("claude", "claude:opus-5.5", "account-lab");
    expect(accountList()).toBeNull();
    expect(panel()!.querySelector('[role="listbox"]')).not.toBeNull();
  });

  it("searches the account list from six accounts", async () => {
    addClaudeAccounts(["work", "lab", "ops", "data", "design"]);
    const onChange = vi.fn();
    await openClaude(onChange);
    await click(accountMenu()!);
    expect(accountRows()).toHaveLength(6);
    await inputText(accountSearch()!, "de");
    expect(accountRows().map(accountLabel)).toEqual(["design"]);
    await click(accountRow("design"));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("claude", "claude:opus-5.5", "account-design");
    expect(accountList()).toBeNull();
  });

  it("uses the account chosen on another provider's tab for the model picked there", async () => {
    seedClaude();
    setHarnessModels("codex", [
      { id: "codex:gpt-6", harness: "codex", name: "GPT 6", nativeId: "gpt-6" },
    ]);
    saveProviderAccount({ id: "account-team", provider: "codex", label: "team" });
    const onChange = vi.fn();
    await openClaude(onChange);
    await click(providerTab("Codex"));
    await click(optionByText(accountSwitch()!, "radio", "team"));
    // Another provider's account waits for the model picked there.
    expect(onChange).not.toHaveBeenCalled();
    await click(optionByText(listbox(), "option", "GPT 6"));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("codex", "codex:gpt-6", "account-team");
    // Picking a model keeps the panel open for its settings.
    expect(panel()).not.toBeNull();
  });
});
