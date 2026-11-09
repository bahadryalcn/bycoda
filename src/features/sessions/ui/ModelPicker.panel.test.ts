// @vitest-environment happy-dom
import { act, createElement, type CSSProperties, type ReactNode } from "react";
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

vi.mock("../../../shared/ui/Popover", () => ({
  Popover: ({
    children,
    role,
    className,
    tabIndex,
    onKeyDown,
    ...props
  }: {
    children: ReactNode;
    role?: string;
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
        role,
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
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
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
    expect(frame.style.height).toBe("460px");
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
    expect(unselectedRow.lastElementChild?.getAttribute("aria-label")).toBe("Add to favorites");

    const settings = container.querySelector("[data-model-settings]")!;
    await click(optionByText(settings, "radio", "Extra High"));
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
      [...listbox().querySelectorAll('[role="group"]')].map((group) =>
        group.getAttribute("aria-label"),
      );
    expect(groups()).toEqual(["OpenCode Go", "OpenAI"]);
    expect(
      listbox().querySelector('[role="group"][aria-label="OpenCode Go"]')?.textContent,
    ).toContain("GPT-5.6 Luna");
    expect(
      listbox().querySelector('[role="option"][aria-label="GPT-5.6 Luna, OpenCode Go"]'),
    ).not.toBeNull();
    expect(listbox().querySelector('[role="group"][aria-label="OpenAI"]')?.textContent).toContain(
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
        option.getAttribute("aria-label"),
      ),
    ).toEqual(["Auto, Cursor", "Muse Spark 1.3, Cursor", "Muse Spark 1.3, OpenCode Go"]);
  });

  it("keeps all consequential effort options as inline selectable rows", async () => {
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
    expect(block.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe("High");
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

  it("lists model and context settings under Settings and delegation under Agents", async () => {
    await openOrdered({});
    const tabs = [...container.querySelectorAll('[data-model-settings] [role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Settings", "Agents"]);
    // Reasoning leads; a dependent setting follows its parent.
    expect(columnLabels()).toEqual(["Reasoning", "Fast", "Auto-compact", "Auto-compact window"]);
    await click(tabs[1]);
    expect(columnLabels()).toEqual(["Advisor", "Image models", "Subagents"]);
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

  it("marks the selected reasoning level and names it above the bars", async () => {
    await openOrdered({ effort: "high" });
    const block = await settingBlock("effort");
    const checked = block.querySelectorAll('[role="radio"][aria-checked="true"]');
    expect(checked).toHaveLength(1);
    expect(checked[0].getAttribute("aria-label")).toBe("high");
    expect(block.firstElementChild?.textContent).toContain("high");
  });

  it("explains the hovered setting in the help strip", async () => {
    await openOrdered({});
    const help = () => container.querySelector("[data-model-setting-help]")!.textContent;
    expect(help()).toContain("Point at a setting");
    await act(async () => {
      container
        .querySelector('[data-setting-id="fast"] [role="switch"]')!
        .dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(help()).toContain("Same model, faster output");
  });

  it("renders the field presentation as a full-width trigger that opens below", async () => {
    await openOrdered({});
    expect(trigger().getAttribute("data-model-picker-presentation")).toBe("inline");
    expect(trigger().classList.contains("model-picker-field-trigger")).toBe(false);
    await render({ harness: "cursor", model: "cursor:ordered", presentation: "field" });
    expect(trigger().getAttribute("data-model-picker-presentation")).toBe("field");
    expect(trigger().classList.contains("model-picker-field-trigger")).toBe(true);
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
    const inherit = listbox().querySelector<HTMLButtonElement>('[role="option"]')!;
    expect(inherit.hasAttribute("data-model-inherit-choice")).toBe(true);
    expect(inherit.textContent).toBe("Use the global agent");
    expect(inherit.getAttribute("aria-selected")).toBe("true");
    // Inherited: no model options to edit.
    expect(container.querySelector("[data-model-settings]")).toBeNull();
    await click(inherit);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(panel()).toBeNull();

    await renderInherit(false);
    await openPanel();
    expect(
      listbox().querySelector("[data-model-inherit-choice]")!.getAttribute("aria-selected"),
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
