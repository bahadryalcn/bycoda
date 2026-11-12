// @vitest-environment happy-dom
import { act, createElement, type CSSProperties, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAdvisor, encodeSubagents } from "../../../shared/model/host-contracts/delegation";

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
  popupListClassName: "shared-popup-list",
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
        role: kind === "dialog" ? "dialog" : role,
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

import { ModelPicker, preloadModelPicker } from "./ModelPicker";
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

describe("cross-provider delegation rows", () => {
  const model = (
    harness: "codex" | "opencode" | "cursor" | "pi",
    nativeId: string,
    name: string,
  ) => ({
    id: `${harness}:${nativeId}`,
    harness,
    name,
    nativeId,
  });
  const codexModel = model("codex", "gpt-6.1-sol", "GPT 6.1 Sol");
  const opencodeModel = model("opencode", "openai/gpt-5.6-luna", "Luna");
  const cursorModel = model("cursor", "composer-2", "Composer 2");
  const piModel = model("pi", "pi-default", "Pi Default");

  function seedCatalogs() {
    setHarnessModels("codex", [codexModel]);
    setHarnessModels("opencode", [opencodeModel]);
    setHarnessModels("cursor", [cursorModel]);
    setHarnessModels("pi", [piModel]);
  }

  const PANEL = '[role="dialog"][aria-label="Model and settings"]';

  async function openPanel(
    harness: "codex" | "opencode" | "cursor" | "pi" | "claude",
    id: string,
    values: Record<string, string> = {},
    onSettingsChange = vi.fn(),
  ) {
    await act(async () =>
      root.render(
        createElement(ModelPicker, {
          harness,
          model: id,
          values,
          showEffortSummary: true,
          onChange: vi.fn(),
          onSettingsChange,
        }),
      ),
    );
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    return showAgents();
  }

  /** The settings column on its Agents tab (shown directly when it holds only delegation). */
  async function showAgents() {
    const column = container.querySelector<HTMLElement>(`${PANEL} [data-model-settings]`)!;
    const tab = [...column.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((item) =>
      item.textContent?.startsWith("Agents"),
    );
    if (tab) await act(async () => tab.click());
    return column;
  }

  /** The labels of the visible setting blocks (a field's inset name, else the block's first text). */
  const settingLabels = (column: HTMLElement) =>
    [...column.querySelectorAll<HTMLElement>("[data-setting-id]")].map(
      (block) =>
        (block.querySelector("[data-setting-label]") ?? block.querySelector("span"))?.textContent ??
        "",
    );

  /** Opens a delegation setting's column-wide list (Add or its value button) and returns its options. */
  const choices = async (column: HTMLElement, label: string) => {
    const id = label === "Subagents" ? "crossSubagents" : "crossAdvisor";
    if (!column.querySelector(`[data-model-setting-picker="${id}"]`)) {
      const block = column.querySelector<HTMLElement>(`[data-setting-id="${id}"]`)!;
      const open =
        block.querySelector<HTMLButtonElement>("[data-model-setting-add]") ??
        block.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]') ??
        // Subagents without a list: the Custom segment opens the picker.
        [...block.querySelectorAll<HTMLElement>("button, [role=radio], [role=tab]")].find(
          (item) => item.textContent === "Custom",
        )!;
      await act(async () => open.click());
    }
    const picker = column.querySelector<HTMLElement>(`[data-model-setting-picker="${id}"]`)!;
    return [...picker.querySelectorAll<HTMLButtonElement>('[role="option"]')];
  };

  it.each([
    ["codex", codexModel.id],
    ["opencode", opencodeModel.id],
    ["cursor", cursorModel.id],
    ["pi", piModel.id],
  ] as const)(
    "shows both any-provider settings on the Agents tab for a %s model",
    async (harness, id) => {
      seedCatalogs();
      const column = await openPanel(harness, id);
      const labels = settingLabels(column);
      expect(labels).toContain("Subagents");
      expect(labels).toContain("Advisor");
      expect(column.querySelector('[data-setting-id="crossSubagents"]')).not.toBeNull();
      expect(column.querySelector('[data-setting-id="crossAdvisor"]')).not.toBeNull();
    },
  );

  it("writes the picked subagents as one encoded list, keeping the panel open", async () => {
    seedCatalogs();
    const onSettingsChange = vi.fn();
    const column = await openPanel("cursor", cursorModel.id, {}, onSettingsChange);
    const codexOption = (await choices(column, "Subagents")).find((option) =>
      option.textContent?.includes("GPT 6.1 Sol"),
    )!;
    expect(codexOption.getAttribute("aria-selected")).toBe("false");
    await act(async () => codexOption.click());
    expect(onSettingsChange).toHaveBeenLastCalledWith({
      crossSubagents: encodeSubagents([
        { harness: "codex", model: codexModel.id, providerAccountId: "default" },
      ]),
    });
    expect(container.querySelector(PANEL)).not.toBeNull();

    // The panel stays open after a subagent pick: re-render with the saved value and add another.
    const picked = encodeSubagents([
      { harness: "codex", model: codexModel.id, providerAccountId: "default" },
    ])!;
    await act(async () =>
      root.render(
        createElement(ModelPicker, {
          harness: "cursor",
          model: cursorModel.id,
          values: { crossSubagents: picked },
          showEffortSummary: true,
          onChange: vi.fn(),
          onSettingsChange,
        }),
      ),
    );
    const second = await showAgents();
    const subagents = await choices(second, "Subagents");
    expect(
      subagents
        .find((option) => option.textContent?.includes("GPT 6.1 Sol"))!
        .getAttribute("aria-selected"),
    ).toBe("true");
    const opencodeOption = subagents.find((option) => option.textContent?.includes("Luna"))!;
    await act(async () => opencodeOption.click());
    expect(onSettingsChange).toHaveBeenLastCalledWith({
      crossSubagents: encodeSubagents([
        { harness: "codex", model: codexModel.id, providerAccountId: "default" },
        { harness: "opencode", model: opencodeModel.id },
      ]),
    });
  });

  it("shows picked subagents as removable chips and closes the list with Done", async () => {
    seedCatalogs();
    const picked = encodeSubagents([
      { harness: "codex", model: codexModel.id, providerAccountId: "default" },
    ])!;
    const onSettingsChange = vi.fn();
    const column = await openPanel(
      "cursor",
      cursorModel.id,
      { crossSubagents: picked },
      onSettingsChange,
    );
    const block = column.querySelector<HTMLElement>('[data-setting-id="crossSubagents"]')!;
    expect(block.textContent).toContain("GPT 6.1 Sol");
    const remove = block.querySelector<HTMLButtonElement>('button[aria-label^="Remove"]')!;
    await act(async () => remove.click());
    expect(onSettingsChange).toHaveBeenLastCalledWith({ crossSubagents: "[]" });

    await act(async () =>
      block.querySelector<HTMLButtonElement>("[data-model-setting-add]")!.click(),
    );
    const picker = column.querySelector<HTMLElement>(
      '[data-model-setting-picker="crossSubagents"]',
    )!;
    // Done sits after the scrolling option list, never inside it.
    const done = [...picker.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Done",
    )!;
    expect(picker.querySelector('[role="listbox"]')!.contains(done)).toBe(false);
    await act(async () => done.click());
    expect(column.querySelector("[data-model-setting-picker]")).toBeNull();
    expect(container.querySelector(PANEL)).not.toBeNull();
  });

  it("offers the current model and other models as advisor, with Off first", async () => {
    seedCatalogs();
    const column = await openPanel("cursor", cursorModel.id);
    const options = await choices(column, "Advisor");
    expect(options[0].textContent).toBe("Off");
    const labels = options.map((option) => option.textContent ?? "");
    expect(labels.some((label) => label.includes("Composer 2"))).toBe(true);
    expect(labels.some((label) => label.includes("GPT 6.1 Sol"))).toBe(true);
  });

  it("picks the advisor as one encoded ref and keeps the panel open", async () => {
    seedCatalogs();
    const onSettingsChange = vi.fn();
    const column = await openPanel("cursor", cursorModel.id, {}, onSettingsChange);
    const codexOption = (await choices(column, "Advisor")).find((option) =>
      option.textContent?.includes("GPT 6.1 Sol"),
    )!;
    await act(async () => codexOption.click());
    expect(onSettingsChange).toHaveBeenLastCalledWith({
      crossAdvisor: encodeAdvisor({
        harness: "codex",
        model: codexModel.id,
        providerAccountId: "default",
      }),
    });
    expect(container.querySelector(PANEL)).not.toBeNull();
  });

  it("shows a saved accountless advisor as the available Default account without rewriting it", async () => {
    seedCatalogs();
    const saved = encodeAdvisor({ harness: "codex", model: codexModel.id })!;
    const onSettingsChange = vi.fn();
    const column = await openPanel(
      "cursor",
      cursorModel.id,
      { crossAdvisor: saved },
      onSettingsChange,
    );
    const options = await choices(column, "Advisor");
    expect(options.some((choice) => choice.textContent?.includes("Unavailable"))).toBe(false);
    const selected = options.filter((choice) => choice.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toContain("GPT 6.1 Sol");
    expect(selected[0].textContent).toContain("Default");
    expect(onSettingsChange).not.toHaveBeenCalled();
    await act(async () => selected[0].click());
    expect(onSettingsChange).toHaveBeenLastCalledWith({ crossAdvisor: saved });
  });

  it("shows one unified delegation setting per kind for Claude", async () => {
    seedCatalogs();
    setHarnessModels("claude", [
      { id: "claude:sonnet-5", harness: "claude", name: "Sonnet 5", nativeId: "sonnet-5" },
    ]);
    const labels = settingLabels(await openPanel("claude", "claude:sonnet-5"));
    expect(labels.filter((label) => label === "Subagents")).toHaveLength(1);
    expect(labels.filter((label) => label === "Advisor")).toHaveLength(1);
    expect(labels).not.toContain("Subagent model");
  });
});
