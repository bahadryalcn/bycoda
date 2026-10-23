// @vitest-environment happy-dom
import { act, createElement, type CSSProperties, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HARNESSES } from "../model/session";

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
    minHeight?: number;
    maxHeight?: number;
    style?: CSSProperties;
    anchor?: unknown;
    side?: string;
    "aria-label"?: string;
    "data-model-picker"?: boolean;
  }) =>
    createElement(
      "div",
      {
        role,
        className,
        tabIndex,
        onKeyDown,
        style: props.style,
        "data-min-height": props.minHeight,
        "data-max-height": props.maxHeight,
        "data-anchor-element":
          props.anchor instanceof HTMLElement ||
          (typeof props.anchor === "object" &&
            props.anchor != null &&
            "current" in props.anchor &&
            props.anchor.current instanceof HTMLElement)
            ? "true"
            : "false",
        "data-side": props.side,
        "aria-label": props["aria-label"],
        "data-model-picker": props["data-model-picker"] ? "" : undefined,
      },
      children,
    ),
}));

import { ModelControlPills, ModelPicker, preloadModelPicker } from "./ModelPicker";
import { ModelSourceContext } from "./modelSource";
import { renameProviderAccount, saveProviderAccount } from "../../providers/model/providerAccounts";
import {
  resetHarnessModelOverlays,
  resetDisabledModels,
  saveModelEnabled,
  saveRecentModelChoice,
  setHarnessModels,
} from "../model/models";

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

async function hover(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
}

async function movePointer(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, movementX: 1 }));
  });
}

async function contextMenu(element: Element) {
  await act(async () => {
    element.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 120,
        clientY: 80,
      }),
    );
  });
}

async function keyDown(target: EventTarget, key: string) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

async function inputText(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("model picker", () => {
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
    const render = async (values: Record<string, string>) =>
      await act(async () =>
        root.render(
          createElement(ModelPicker, {
            harness: "cursor",
            model: "cursor:dependent",
            values,
            onChange: vi.fn(),
            onSettingsChange,
          }),
        ),
      );
    await render({});
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click(),
    );
    const childRow = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (button) => button.textContent?.startsWith("Child"),
    )!;
    expect(childRow.disabled).toBe(true);
    await hover(childRow);
    expect(container.querySelector('[role="menuitemradio"]')).toBeNull();
    await render({ [parent]: "enabled" });
    expect(childRow.disabled).toBe(false);
    await act(async () => childRow.click());
    const custom = [
      ...container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    ].find((button) => button.textContent === "Custom")!;
    await act(async () => custom.click());
    expect(onSettingsChange).toHaveBeenCalledWith({
      [parent]: "enabled",
      [child]: "custom",
    });
  });
  it("selects a model and its named account together and searches account names", async () => {
    renameProviderAccount("claude", "default", "personal");
    saveProviderAccount({
      id: "account-work",
      provider: "claude",
      label: "work",
    });
    setHarnessModels("claude", [
      {
        id: "claude:opus-5.5",
        harness: "claude",
        name: "Opus 5.5",
        nativeId: "opus-5.5",
        settings: [],
      },
    ]);
    const onChange = vi.fn();
    await act(async () =>
      root.render(
        createElement(ModelPicker, {
          harness: "claude",
          model: "claude:opus-5.5",
          values: {},
          hideSettings: true,
          accountChoices: true,
          accountId: "account-work",
          onChange,
          onSettingsChange: vi.fn(),
        }),
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>("button")!;
    expect(trigger.textContent).toContain("Opus 5.5 work");
    await act(async () => trigger.click());
    const options = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="option"]'));
    expect(options.map((item) => item.textContent?.trim())).toEqual([
      "Opus 5.5 personal",
      "Opus 5.5 work",
    ]);
    expect(options.map((item) => item.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    await inputText(container.querySelector<HTMLInputElement>("input")!, "personal");
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(1);
    await act(async () => container.querySelector<HTMLButtonElement>('[role="option"]')!.click());
    expect(onChange).toHaveBeenCalledWith("claude", "claude:opus-5.5", "default");
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
    await act(async () =>
      root.render(
        createElement(ModelPicker, {
          harness: "cursor",
          model: "cursor:focus",
          values: {},
          onChange: vi.fn(),
          onSettingsChange: vi.fn(),
        }),
      ),
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click(),
    );
    const models = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.startsWith("Model"),
    )!;
    await hover(models);
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    const search = container.querySelector<HTMLInputElement>('input[aria-label="Search models"]');
    expect(search).not.toBeNull();
    expect(document.activeElement).toBe(search);
  });
  it("filters a host catalog and reacts when model settings change", async () => {
    const models = [
      { id: "claude:opus-4-6", name: "Opus", harness: "claude" as const },
      { id: "claude:sonnet-5", name: "Sonnet", harness: "claude" as const },
    ];
    const source = {
      modelsFor: () => models,
      resolve: () => models[0],
      find: (id: string) => models.find((model) => model.id === id),
      available: () => true,
      probed: () => true,
      refresh: () => {},
    };
    saveModelEnabled("claude:opus-4.6", false);
    await act(async () =>
      root.render(
        createElement(
          ModelSourceContext.Provider,
          { value: source },
          createElement(ModelPicker, {
            harness: "claude",
            model: models[0].id,
            values: {},
            hideSettings: true,
            onChange: vi.fn(),
            onSettingsChange: vi.fn(),
          }),
        ),
      ),
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!.click(),
    );
    expect(
      [...container.querySelectorAll('[role="option"]')].map((item) => item.textContent),
    ).toEqual(["Sonnet"]);
    await act(async () => saveModelEnabled("claude:opus-4.6", true));
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(2);
  });

  it("excludes disabled and disallowed models from the recent menu", async () => {
    saveRecentModelChoice("claude", "claude:opus-5");
    saveRecentModelChoice("cursor", "cursor:composer-2.5");
    saveModelEnabled("claude:opus-5", false);
    await act(async () =>
      root.render(
        createElement(ModelPicker, {
          harness: "grok",
          model: "grok:grok-4.6",
          values: {},
          allowedHarnesses: ["grok", "claude"],
          onChange: vi.fn(),
          onSettingsChange: vi.fn(),
        }),
      ),
    );
    await contextMenu(container.querySelector('button[aria-haspopup="menu"]')!);
    const items = container.querySelectorAll('[role="menuitemradio"]');
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain("Grok 4.6");
  });
  it("keeps the flyout compact when only a few providers are visible", async () => {
    await act(async () =>
      root.render(
        createElement(ModelPicker, {
          harness: "claude",
          model: "claude:opus-5",
          values: {},
          allowedHarnesses: ["claude", "codex", "grok"],
          onChange: vi.fn(),
          onSettingsChange: vi.fn(),
        }),
      ),
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click(),
    );
    const row = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (button) => button.textContent?.startsWith("Model"),
    )!;
    await hover(row);
    const flyout = container.querySelector<HTMLElement>('[role="dialog"][aria-label="Models"]')!;
    expect(flyout.querySelectorAll('[role="tab"]')).toHaveLength(4);
    expect(flyout.style.height).toBe("300px");
    expect(flyout.style.maxHeight).toBe("");
    expect(flyout.dataset.minHeight).toBeUndefined();
    expect(flyout.dataset.maxHeight).toBe("302");
  });

  it("shows the model name and effort in the combined picker", async () => {
    const onChange = vi.fn();
    const onSettingsChange = vi.fn();
    await act(async () =>
      root.render(
        createElement(ModelPicker, {
          harness: "grok",
          model: "grok:grok-4.6",
          values: { effort: "high" },
          onChange,
          onSettingsChange,
        }),
      ),
    );

    const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
    expect(trigger.textContent).toBe("Grok 4.6High");
    expect(trigger.getAttribute("aria-label")).toBe("Grok Build Grok 4.6, effort High");
    expect(trigger.querySelector("[data-model-effort]")?.textContent).toBe("High");
    expect(trigger.querySelector("svg")).not.toBeNull();

    await act(async () => trigger.click());
    const modelRow = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.startsWith("Model"),
    )!;
    expect(modelRow.textContent).toContain("Grok 4.6");
    expect(modelRow.querySelectorAll("svg")).toHaveLength(2);

    await hover(modelRow);
    const modelFlyout = container.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Models"]',
    )!;
    // Reserve a 32px tab for every registered provider and Favorites, with
    // 4px gaps, 12px rail padding and a 2px frame.
    const railHeight = (HARNESSES.length + 1) * 32 + HARNESSES.length * 4 + 12;
    expect(modelFlyout.style.height).toBe(`${railHeight}px`);
    expect(modelFlyout.dataset.minHeight).toBeUndefined();
    expect(modelFlyout.dataset.maxHeight).toBe(String(railHeight + 2));
    expect(container.querySelector('[role="tablist"][aria-orientation="vertical"]')).not.toBeNull();
    expect(container.querySelector('[role="tab"][aria-label="Favorites"]')).not.toBeNull();
    expect(container.querySelector('[role="tab"][aria-label="Antigravity"]')).not.toBeNull();
    const grokTab = container.querySelector<HTMLButtonElement>(
      '[role="tab"][aria-label="Grok Build"]',
    )!;
    expect(grokTab.className).toContain("bycoda-arc");
    expect(grokTab.className).not.toContain("transition");
    await movePointer(grokTab);
    expect(grokTab.getAttribute("aria-selected")).toBe("true");
    expect(
      [...container.querySelectorAll('[role="option"]')].some(
        (option) => option.textContent === "Grok 4.6",
      ),
    ).toBe(true);
    const selectedOption = container.querySelector<HTMLButtonElement>(
      '[role="option"][aria-selected="true"]',
    )!;
    const selectedRow = selectedOption.parentElement!;
    const favoriteButton = selectedRow.querySelector<HTMLButtonElement>(
      'button[aria-label="Add to favorites"]',
    )!;
    expect(favoriteButton.className).toContain("bycoda-arc");

    expect(selectedRow.lastElementChild?.querySelector("svg")).not.toBeNull();
    const unselectedOption = container.querySelector<HTMLButtonElement>(
      '[role="option"][aria-selected="false"]',
    )!;
    const unselectedRow = unselectedOption.parentElement!;
    expect(unselectedRow.lastElementChild?.getAttribute("aria-label")).toBe("Add to favorites");
    expect(container.querySelector('input[aria-label="Search models"]')).not.toBeNull();

    const effortRow = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.startsWith("Reasoning"),
    )!;
    await hover(effortRow);
    const extraHigh = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Extra High",
    )!;
    await act(async () => extraHigh.click());

    expect(onSettingsChange).toHaveBeenCalledWith({ effort: "xhigh" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("lists Claude Opus 5.5 after Opus 5 in the built-in Claude catalog", async () => {
    await act(async () =>
      root.render(
        createElement(ModelPicker, {
          harness: "claude",
          model: "claude:opus-5-5",
          values: {},
          onChange: vi.fn(),
          onSettingsChange: vi.fn(),
        }),
      ),
    );

    const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
    expect(trigger.textContent).toContain("Claude Opus 5.5");

    await act(async () => trigger.click());
    const modelRow = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.startsWith("Model"),
    );
    if (modelRow) await hover(modelRow);
    const options = [...container.querySelectorAll('[role="option"]')].map(
      (option) => option.textContent,
    );
    expect(options).toContain("Claude Opus 5.5");
    expect(options.indexOf("Claude Opus 5.5")).toBe(options.indexOf("Claude Opus 5") + 1);
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

    await act(async () =>
      root.render(
        createElement(ModelPicker, {
          harness: "opencode",
          model: "opencode:opencode-go/gpt-5.6-luna",
          values: {},
          onChange: vi.fn(),
          onSettingsChange: vi.fn(),
        }),
      ),
    );

    const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
    expect(trigger.getAttribute("aria-label")).toBe("OpenCode, OpenCode Go, GPT-5.6 Luna");
    await act(async () => trigger.click());
    const modelRow = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.startsWith("Model"),
    )!;
    await hover(modelRow);

    expect(
      [...container.querySelectorAll('[role="group"]')].map((group) =>
        group.getAttribute("aria-label"),
      ),
    ).toEqual(["OpenCode Go", "OpenAI"]);
    expect(
      container.querySelector('[role="group"][aria-label="OpenCode Go"]')?.textContent,
    ).toContain("GPT-5.6 Luna");
    expect(
      container.querySelector('[role="option"][aria-label="GPT-5.6 Luna, OpenCode Go"]'),
    ).not.toBeNull();
    expect(container.querySelector('[role="group"][aria-label="OpenAI"]')?.textContent).toContain(
      "GPT-5.6 Luna Fast",
    );

    await inputText(
      container.querySelector<HTMLInputElement>('input[aria-label="Search models"]')!,
      "OpenAI",
    );
    expect(
      [...container.querySelectorAll('[role="group"]')].map((group) =>
        group.getAttribute("aria-label"),
      ),
    ).toEqual(["OpenAI"]);
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(2);
  });

  it("names the source of same-name favorites from different providers", async () => {
    setHarnessModels("cursor", [
      {
        id: "cursor:auto",
        harness: "cursor",
        name: "Auto",
        nativeId: "auto",
      },
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

    await act(async () =>
      root.render(
        createElement(ModelPicker, {
          harness: "cursor",
          model: "cursor:auto",
          values: {},
          onChange: vi.fn(),
          onSettingsChange: vi.fn(),
        }),
      ),
    );

    const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
    await act(async () => trigger.click());
    const modelRow = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.startsWith("Model"),
    )!;
    await hover(modelRow);
    const favoritesTab = container.querySelector<HTMLButtonElement>(
      '[role="tab"][aria-label="Favorites"]',
    )!;
    await act(async () => favoritesTab.click());

    const options = [...container.querySelectorAll('[role="option"]')].map((option) =>
      option.getAttribute("aria-label"),
    );
    expect(options).toEqual([
      "Auto, Cursor",
      "Muse Spark 1.3, Cursor",
      "Muse Spark 1.3, OpenCode Go",
    ]);
  });

  it("keeps the effort summary next to the model when settings are in Extras", async () => {
    await act(async () =>
      root.render(
        createElement(ModelPicker, {
          harness: "grok",
          model: "grok:grok-4.6",
          values: { effort: "medium" },
          hideSettings: true,
          showEffortSummary: true,
          onChange: vi.fn(),
          onSettingsChange: vi.fn(),
        }),
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Grok Build Grok 4.6, effort Medium"]',
    )!;
    expect(trigger.textContent).toBe("Grok 4.6Medium");
    await act(async () => trigger.click());
    expect(container.querySelector('[role="menu"][aria-label="Effort"]')).toBeNull();
  });

  it("can move effort into a dedicated composer control", async () => {
    const onSettingsChange = vi.fn();
    await act(async () =>
      root.render(
        createElement(
          "div",
          null,
          createElement(ModelPicker, {
            harness: "grok",
            model: "grok:grok-4.6",
            values: { effort: "high" },
            hideSettings: true,
            onChange: vi.fn(),
            onSettingsChange,
          }),
          createElement(ModelControlPills, {
            harness: "grok",
            model: "grok:grok-4.6",
            values: { effort: "high" },
            onSettingsChange,
          }),
        ),
      ),
    );

    const modelTrigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Grok Build Grok 4.6"]',
    )!;
    expect(modelTrigger.textContent).toBe("Grok 4.6");
    await act(async () => modelTrigger.click());
    expect(
      [...container.querySelectorAll<HTMLButtonElement>("button")].some((button) =>
        button.textContent?.startsWith("Effort"),
      ),
    ).toBe(false);

    const effortTrigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Effort: High"]',
    )!;
    expect(effortTrigger.textContent).toBe("High");
    expect(effortTrigger.querySelector("svg")).not.toBeNull();
    await act(async () => effortTrigger.click());
    const effortMenu = container.querySelector<HTMLElement>(
      'button[role="combobox"][aria-label="Effort: High"]',
    )!;
    expect(effortMenu).not.toBeNull();
    await keyDown(effortMenu, "ArrowUp");
    await keyDown(effortMenu, "Enter");
    expect(onSettingsChange).toHaveBeenCalledWith({ effort: "xhigh" });
  });

  it("opens the model list with no intermediate menu when settings live beside the picker", async () => {
    setHarnessModels("cursor", [
      {
        id: "cursor:composer-2.5",
        harness: "cursor",
        name: "Composer 2.5",
        nativeId: "composer-2.5",
        settings: [
          {
            id: "fast",
            label: "Fast",
            kind: "toggle",
            value: "false",
            options: [
              { value: "false", label: "Off" },
              { value: "true", label: "On" },
            ],
          },
        ],
      },
    ]);
    const onSettingsChange = vi.fn();
    await act(async () =>
      root.render(
        createElement(
          "div",
          null,
          createElement(ModelPicker, {
            harness: "cursor",
            model: "cursor:composer-2.5",
            values: { fast: "false" },
            hideSettings: true,
            onChange: vi.fn(),
            onSettingsChange,
          }),
          createElement(ModelControlPills, {
            harness: "cursor",
            model: "cursor:composer-2.5",
            values: { fast: "false" },
            onSettingsChange,
          }),
        ),
      ),
    );

    const modelTrigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    )!;
    await act(async () => modelTrigger.click());
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(container.querySelector('[role="dialog"][aria-label="Models"]')).not.toBeNull();

    const fastPill = container.querySelector<HTMLButtonElement>('button[aria-label="Fast: Off"]')!;
    expect(fastPill.getAttribute("aria-pressed")).toBe("false");
    await act(async () => fastPill.click());
    expect(onSettingsChange).toHaveBeenCalledWith({ fast: "true" });
  });

  it("renders the OpenCode variant as a beside-picker pill", async () => {
    setHarnessModels("opencode", [
      {
        id: "opencode:some-cloud/spark-1",
        harness: "opencode",
        name: "Spark 1",
        nativeId: "some-cloud/spark-1",
        provider: { id: "some-cloud", name: "Some Cloud" },
        settings: [
          {
            id: "variant",
            label: "Variant",
            kind: "select",
            value: "high",
            options: [
              { value: "low", label: "Low" },
              { value: "medium", label: "Medium" },
              { value: "high", label: "High" },
              { value: "xhigh", label: "Extra High" },
            ],
          },
        ],
      },
    ]);
    await act(async () =>
      root.render(
        createElement(ModelControlPills, {
          harness: "opencode",
          model: "opencode:some-cloud/spark-1",
          values: { variant: "high" },
          onSettingsChange: vi.fn(),
        }),
      ),
    );

    const variantPill = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Variant: High"]',
    )!;
    expect(variantPill.textContent).toBe("High");
    await act(async () => variantPill.click());
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();
  });

  it.each(["pi", "omp"] as const)(
    "shows an effort icon for %s thinking levels",
    async (harness) => {
      const model = `${harness}:gpt-5.4-mini`;
      setHarnessModels(harness, [
        {
          id: model,
          harness,
          name: "GPT-5.4 mini",
          nativeId: "gpt-5.4-mini",
          settings: [
            {
              id: "thinking",
              label: "Thinking",
              kind: "select",
              value: "xhigh",
              options: [
                { value: "high", label: "High" },
                { value: "xhigh", label: "Extra High" },
              ],
            },
          ],
        },
      ]);

      await act(async () =>
        root.render(
          createElement(ModelControlPills, {
            harness,
            model,
            values: { thinking: "xhigh" },
            onSettingsChange: vi.fn(),
          }),
        ),
      );

      const effortPill = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Thinking: Extra High"]',
      )!;
      expect(effortPill.textContent).toBe("Extra High");
      expect(effortPill.querySelector("svg")).not.toBeNull();
    },
  );

  it("shows a speed icon on the service-tier pill", async () => {
    setHarnessModels("codex", [
      {
        id: "codex:gpt-5.6-luna",
        harness: "codex",
        name: "GPT-5.6 Luna",
        nativeId: "gpt-5.6-luna",
        settings: [
          {
            id: "serviceTier",
            label: "Service Tier",
            kind: "select",
            value: "default",
            options: [
              { value: "default", label: "Standard" },
              { value: "fast", label: "Fast" },
            ],
          },
        ],
      },
    ]);

    await act(async () =>
      root.render(
        createElement(ModelControlPills, {
          harness: "codex",
          model: "codex:gpt-5.6-luna",
          values: { serviceTier: "default" },
          onSettingsChange: vi.fn(),
        }),
      ),
    );

    const serviceTierPill = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Service Tier: Standard"]',
    )!;
    expect(serviceTierPill.textContent).toBe("Standard");
    expect(serviceTierPill.querySelector("svg")).not.toBeNull();
  });

  it("keeps all consequential effort options in shared selectable rows", async () => {
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

    await act(async () =>
      root.render(
        createElement(ModelPicker, {
          harness: "codex",
          model: "codex:gpt-5.6",
          values: { reasoningEffort: "high" },
          onChange: vi.fn(),
          onSettingsChange: vi.fn(),
        }),
      ),
    );

    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.click(),
    );
    const effortRow = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.startsWith("Reasoning"),
    )!;
    await hover(effortRow);

    expect(container.querySelectorAll('[role="menuitemradio"]')).toHaveLength(4);
    expect(
      container.querySelector('[role="menuitemradio"][aria-checked="true"]')?.textContent,
    ).toBe("High");
  });

  it("keeps service tier independent while preserving effort on a change", async () => {
    setHarnessModels("codex", [
      {
        id: "codex:gpt-5.6-sol",
        harness: "codex",
        name: "GPT-5.6 Sol",
        nativeId: "gpt-5.6-sol",
        settings: [
          {
            id: "reasoningEffort",
            label: "Reasoning",
            kind: "select",
            value: "high",
            options: [
              { value: "high", label: "High" },
              { value: "xhigh", label: "Extra High" },
            ],
          },
          {
            id: "serviceTier",
            label: "Service Tier",
            kind: "select",
            value: "default",
            options: [
              { value: "default", label: "Standard" },
              { value: "fast", label: "Fast" },
            ],
          },
        ],
      },
    ]);
    const onSettingsChange = vi.fn();

    await act(async () =>
      root.render(
        createElement(ModelControlPills, {
          harness: "codex",
          model: "codex:gpt-5.6-sol",
          values: { reasoningEffort: "high", serviceTier: "default" },
          onSettingsChange,
        }),
      ),
    );

    const tier = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Service Tier: Standard"]',
    )!;
    expect(tier).not.toBeNull();
    await act(async () => tier.click());
    const fast =
      container.querySelector<HTMLElement>('[role="option"][data-value="fast"]') ??
      [...container.querySelectorAll<HTMLElement>('[role="option"]')].find((el) =>
        el.textContent?.includes("Fast"),
      )!;
    await act(async () => fast.click());
    expect(onSettingsChange).toHaveBeenCalledWith({
      reasoningEffort: "high",
      serviceTier: "fast",
    });
  });

  it("keeps fast mode independent while preserving effort on a change", async () => {
    setHarnessModels("claude", [
      {
        id: "claude:opus-5",
        harness: "claude",
        name: "Opus 5",
        nativeId: "claude-opus-5",
        settings: [
          {
            id: "effort",
            label: "Reasoning",
            kind: "select",
            value: "high",
            options: [
              { value: "medium", label: "Medium" },
              { value: "high", label: "High" },
            ],
          },
          {
            id: "fast",
            label: "Fast",
            kind: "toggle",
            value: "false",
            options: [
              { value: "false", label: "Off" },
              { value: "true", label: "On" },
            ],
          },
        ],
      },
    ]);
    const onSettingsChange = vi.fn();

    await act(async () =>
      root.render(
        createElement(ModelControlPills, {
          harness: "claude",
          model: "claude:opus-5",
          values: { effort: "high", fast: "false" },
          onSettingsChange,
        }),
      ),
    );

    const fast = container.querySelector<HTMLButtonElement>('button[aria-label="Fast: Off"]')!;
    expect(fast).not.toBeNull();
    await act(async () => fast.click());
    const on = [...container.querySelectorAll<HTMLElement>('[role="option"]')].find((el) =>
      el.textContent?.includes("On"),
    )!;
    await act(async () => on.click());
    expect(onSettingsChange).toHaveBeenCalledWith({
      effort: "high",
      fast: "true",
    });
  });

  it("opens the model list directly when settings live beside the picker", async () => {
    setHarnessModels("cursor", [
      {
        id: "cursor:composer-2.5",
        harness: "cursor",
        name: "Composer 2.5",
        nativeId: "composer-2.5",
        settings: [
          {
            id: "fast",
            label: "Fast",
            kind: "toggle",
            value: "false",
            options: [
              { value: "false", label: "Off" },
              { value: "true", label: "On" },
            ],
          },
        ],
      },
    ]);
    const onChange = vi.fn();
    await act(async () =>
      root.render(
        createElement(ModelPicker, {
          harness: "cursor",
          model: "cursor:composer-2.5",
          values: { fast: "false" },
          hideSettings: true,
          onChange,
          onSettingsChange: vi.fn(),
        }),
      ),
    );

    const modelTrigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    )!;
    await act(async () => modelTrigger.click());
    expect(container.querySelector('[role="menu"]')).toBeNull();
    const flyout = container.querySelector<HTMLElement>('[role="dialog"][aria-label="Models"]')!;
    expect(flyout).not.toBeNull();
    expect(flyout.textContent).toContain("Composer 2.5");

    const selected = flyout.querySelector<HTMLButtonElement>(
      '[role="option"][aria-selected="true"]',
    )!;
    await act(async () => selected.click());
    expect(onChange).toHaveBeenCalledWith("cursor", "cursor:composer-2.5");
  });

  it("opens the current selection's extras inside the flyout and returns to the models", async () => {
    setHarnessModels("cursor", [
      {
        id: "cursor:composer-2.5",
        harness: "cursor",
        name: "Composer 2.5",
        nativeId: "composer-2.5",
        settings: [
          {
            id: "fast",
            label: "Fast",
            kind: "toggle",
            value: "false",
            options: [
              { value: "false", label: "Off" },
              { value: "true", label: "On" },
            ],
          },
        ],
      },
    ]);
    const onSettingsChange = vi.fn();
    await act(async () =>
      root.render(
        createElement(ModelPicker, {
          harness: "cursor",
          model: "cursor:composer-2.5",
          values: { fast: "false" },
          hideSettings: true,
          showExtras: true,
          onChange: vi.fn(),
          onSettingsChange,
        }),
      ),
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!.click(),
    );
    const entry = container.querySelector<HTMLButtonElement>("[data-model-extras-entry]")!;
    expect(entry).not.toBeNull();
    await act(async () => entry.click());
    const extras = container.querySelector<HTMLElement>(
      '[role="group"][aria-label="Provider extras"]',
    )!;
    expect(extras).not.toBeNull();
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    const toggle = extras.querySelector<HTMLInputElement>('button[role="switch"]')!;
    await act(async () => toggle.click());
    expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ fast: "true" }));
    await act(async () =>
      extras.querySelector<HTMLButtonElement>('button[aria-label="Back"]')!.click(),
    );
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();
  });

  it("keeps the extras entry out of pickers that don't keep changes", async () => {
    await act(async () =>
      root.render(
        createElement(ModelPicker, {
          harness: "cursor",
          model: "cursor:composer-2.5",
          values: { fast: "false" },
          hideSettings: true,
          onChange: vi.fn(),
          onSettingsChange: vi.fn(),
        }),
      ),
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!.click(),
    );
    expect(container.querySelector("[data-model-extras-entry]")).toBeNull();
  });

  it("picks the highlighted model on Enter even when focus sits on another row", async () => {
    setHarnessModels("cursor", [
      {
        id: "cursor:first",
        harness: "cursor",
        name: "First",
        nativeId: "first",
      },
      {
        id: "cursor:second",
        harness: "cursor",
        name: "Second",
        nativeId: "second",
      },
    ]);
    const onChange = vi.fn();
    await act(async () =>
      root.render(
        createElement(ModelPicker, {
          harness: "cursor",
          model: "cursor:first",
          values: {},
          hideSettings: true,
          onChange,
          onSettingsChange: vi.fn(),
        }),
      ),
    );

    const modelTrigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    )!;
    await act(async () => modelTrigger.click());
    const options = [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    expect(options).toHaveLength(2);
    // Focus stays on the first row while arrows move the highlight.
    options[0].focus();
    await keyDown(options[0], "ArrowDown");
    await keyDown(options[0], "Enter");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("cursor", "cursor:second");
  });

  it("leaves favorite toggles to native activation on Enter", async () => {
    setHarnessModels("cursor", [
      {
        id: "cursor:first",
        harness: "cursor",
        name: "First",
        nativeId: "first",
      },
      {
        id: "cursor:second",
        harness: "cursor",
        name: "Second",
        nativeId: "second",
      },
    ]);
    const onChange = vi.fn();
    await act(async () =>
      root.render(
        createElement(ModelPicker, {
          harness: "cursor",
          model: "cursor:first",
          values: {},
          hideSettings: true,
          onChange,
          onSettingsChange: vi.fn(),
        }),
      ),
    );

    const modelTrigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    )!;
    await act(async () => modelTrigger.click());
    const star = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add to favorites"]',
    )!;
    star.focus();
    await keyDown(star, "Enter");
    // No model pick hijacks the favorite toggle (native click owns it).
    expect(onChange).not.toHaveBeenCalled();
  });

  it("returns to the selected model's harness when reopened", async () => {
    await act(async () =>
      root.render(
        createElement(ModelPicker, {
          harness: "grok",
          model: "grok:grok-4.6",
          values: { effort: "high" },
          onChange: vi.fn(),
          onSettingsChange: vi.fn(),
        }),
      ),
    );

    const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
    await act(async () => trigger.click());
    let modelRow = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.startsWith("Model"),
    )!;
    await hover(modelRow);

    const openCodeTab = container.querySelector<HTMLButtonElement>(
      '[role="tab"][aria-label="OpenCode"]',
    )!;
    await hover(openCodeTab);
    expect(openCodeTab.getAttribute("aria-selected")).toBe("false");
    await movePointer(openCodeTab);
    expect(openCodeTab.getAttribute("aria-selected")).toBe("true");

    await act(async () => trigger.click());
    await act(async () => trigger.click());
    modelRow = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.startsWith("Model"),
    )!;
    await hover(modelRow);

    expect(
      container
        .querySelector('[role="tab"][aria-label="Grok Build"]')
        ?.getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("quick-switches between recently used models on right-click", async () => {
    saveRecentModelChoice("claude", "claude:opus-5");
    saveRecentModelChoice("cursor", "cursor:composer-2.5");
    const onChange = vi.fn();
    await act(async () =>
      root.render(
        createElement(ModelPicker, {
          harness: "grok",
          model: "grok:grok-4.6",
          values: { effort: "high" },
          hotkeys: true,
          onChange,
          onSettingsChange: vi.fn(),
        }),
      ),
    );

    const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
    await contextMenu(trigger);

    const recentMenu = container.querySelector<HTMLElement>(
      '[role="menu"][aria-label="Recently used models"]',
    )!;
    expect(recentMenu.dataset.anchorElement).toBe("true");
    expect(recentMenu.dataset.side).toBe("top");
    const recentItems = [
      ...recentMenu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    ];
    expect(recentItems).toHaveLength(3);
    const grokModel = recentItems.find((item) => item.textContent?.includes("Grok 4.6"))!;
    const claudeModel = recentItems.find((item) => item.textContent?.includes("Opus 5"))!;
    const cursorModel = recentItems.find((item) => item.textContent?.includes("Composer 2.5"))!;
    expect(cursorModel.textContent).toContain("Cursor");
    expect(cursorModel.querySelector("svg")).not.toBeNull();

    // The composer can retain focus after opening its toolbar menu. Recent
    // model navigation still needs to own these keys in that state.
    trigger.focus();
    expect(grokModel.dataset.buttonSelected).toBe("true");
    await keyDown(trigger, "ArrowUp");
    expect(claudeModel.dataset.buttonSelected).toBe("true");
    await keyDown(trigger, "ArrowDown");
    expect(grokModel.dataset.buttonSelected).toBe("true");
    await keyDown(trigger, "ArrowDown");
    expect(cursorModel.dataset.buttonSelected).toBe("true");

    await keyDown(trigger, "Enter");
    expect(onChange).toHaveBeenCalledWith("cursor", "cursor:composer-2.5");
    expect(container.querySelector('[role="menu"][aria-label="Recently used models"]')).toBeNull();

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: ".",
          code: "Period",
          metaKey: true,
          bubbles: true,
        }),
      );
    });
    expect(
      container.querySelector('[role="menu"][aria-label="Recently used models"]'),
    ).not.toBeNull();
    expect(container.querySelector('[role="menu"][aria-label="Model and settings"]')).toBeNull();
  });
});

it("does not refresh or erase model search when a host source object is republished", async () => {
  const models = [{ id: "claude:opus-4-6", name: "Opus", harness: "claude" as const }];
  const refresh = vi.fn();
  const source = {
    id: "remote:host",
    modelsFor: () => models,
    resolve: () => models[0],
    find: () => models[0],
    available: () => true,
    probed: () => true,
    refresh,
  };
  const props = {
    harness: "claude" as const,
    model: models[0].id,
    values: {},
    hideSettings: true,
    onChange: vi.fn(),
    onSettingsChange: vi.fn(),
  };
  const render = async (value: typeof source) =>
    await act(async () =>
      root.render(
        createElement(ModelSourceContext.Provider, { value }, createElement(ModelPicker, props)),
      ),
    );
  await render(source);
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!.click(),
  );
  const search = container.querySelector<HTMLInputElement>('input[aria-label="Search models"]')!;
  await inputText(search, "Opus");
  const refreshCount = refresh.mock.calls.length;
  expect(refreshCount).toBeGreaterThan(0);
  await render({ ...source });
  expect(refresh).toHaveBeenCalledTimes(refreshCount);
  expect(
    container.querySelector<HTMLInputElement>('input[aria-label="Search models"]')!.value,
  ).toBe("Opus");
});
