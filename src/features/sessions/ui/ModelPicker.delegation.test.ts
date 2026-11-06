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

async function hover(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
}

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

  async function openMenu(
    harness: "codex" | "opencode" | "cursor" | "pi",
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
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click(),
    );
    return container.querySelector<HTMLElement>('[role="menu"][aria-label="Model and settings"]')!;
  }

  /** The row labels of the menu's settings (not the model list). */
  const rowLabels = (menu: HTMLElement) =>
    [...menu.children].map((child) =>
      child.getAttribute("data-model-group")
        ? `# ${child.textContent}`
        : (child.querySelector("span")?.textContent ?? ""),
    );

  async function openFlyout(menu: HTMLElement, label: string) {
    const row = [...menu.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.querySelector("span")?.textContent === label,
    )!;
    await hover(row);
    return container.querySelector<HTMLElement>(`[role="menu"][aria-label="${label}"]`)!;
  }

  it.each([
    ["codex", codexModel.id],
    ["opencode", opencodeModel.id],
    ["cursor", cursorModel.id],
    ["pi", piModel.id],
  ] as const)("shows both any-provider rows for a %s model", async (harness, id) => {
    seedCatalogs();
    const menu = await openMenu(harness, id);
    const labels = rowLabels(menu);
    expect(labels).toContain("Subagents (any provider)");
    expect(labels).toContain("Advisor (any provider)");
    expect(labels.indexOf("# Advisor and subagents")).toBe(0);
  });

  it("writes the picked subagents as one encoded list, keeping the menu open", async () => {
    seedCatalogs();
    const onSettingsChange = vi.fn();
    const menu = await openMenu("cursor", cursorModel.id, {}, onSettingsChange);
    const flyout = await openFlyout(menu, "Subagents (any provider)");
    const codexOption = [
      ...flyout.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]'),
    ].find((option) => option.textContent?.includes("GPT 6.1 Sol"))!;
    await act(async () => codexOption.click());
    expect(onSettingsChange).toHaveBeenLastCalledWith({
      crossSubagents: encodeSubagents([{ harness: "codex", model: codexModel.id }]),
    });
    expect(
      container.querySelector('[role="menu"][aria-label="Model and settings"]'),
    ).not.toBeNull();

    // The menu stays open after a subagent pick: re-render with the saved value and reopen the flyout.
    const picked = encodeSubagents([{ harness: "codex", model: codexModel.id }]);
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
    const second = await openFlyout(menu, "Subagents (any provider)");
    const opencodeOption = [
      ...second.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]'),
    ].find((option) => option.textContent?.includes("Luna"))!;
    await act(async () => opencodeOption.click());
    expect(onSettingsChange).toHaveBeenLastCalledWith({
      crossSubagents: encodeSubagents([
        { harness: "codex", model: codexModel.id },
        { harness: "opencode", model: opencodeModel.id },
      ]),
    });
  });

  it("offers the advisor from other models only, with Off first", async () => {
    seedCatalogs();
    const menu = await openMenu("cursor", cursorModel.id);
    const flyout = await openFlyout(menu, "Advisor (any provider)");
    const options = [...flyout.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
    expect(options[0].textContent).toBe("Off");
    const labels = options.map((option) => option.textContent ?? "");
    expect(labels.some((label) => label.includes("Composer 2"))).toBe(false);
    expect(labels.some((label) => label.includes("GPT 6.1 Sol"))).toBe(true);
  });

  it("picks the advisor as one encoded ref and closes the menu", async () => {
    seedCatalogs();
    const onSettingsChange = vi.fn();
    const menu = await openMenu("cursor", cursorModel.id, {}, onSettingsChange);
    const flyout = await openFlyout(menu, "Advisor (any provider)");
    const codexOption = [
      ...flyout.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    ].find((option) => option.textContent?.includes("GPT 6.1 Sol"))!;
    await act(async () => codexOption.click());
    expect(onSettingsChange).toHaveBeenLastCalledWith({
      crossAdvisor: encodeAdvisor({ harness: "codex", model: codexModel.id }),
    });
    expect(container.querySelector('[role="menu"][aria-label="Model and settings"]')).toBeNull();
  });

  it("keeps Claude's native advisor and subagent rows ahead of the any-provider rows", async () => {
    seedCatalogs();
    setHarnessModels("claude", [
      { id: "claude:sonnet-5", harness: "claude", name: "Sonnet 5", nativeId: "sonnet-5" },
    ]);
    const menu = await openMenu("claude", "claude:sonnet-5");
    const labels = rowLabels(menu);
    const native = labels.indexOf("Advisor");
    const anyProvider = labels.indexOf("Subagents (any provider)");
    expect(native).toBeGreaterThan(-1);
    expect(anyProvider).toBeGreaterThan(native);
    expect(labels.indexOf("Advisor (any provider)")).toBeGreaterThan(native);
  });
});
