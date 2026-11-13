// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  resetDisabledModels,
  resetHarnessModelOverlays,
  resolveModel,
  modelsFor,
  saveModelEnabled,
  setHarnessModels,
} from "../model/models";
vi.mock("./modelSource", () => ({
  useModelSource: () => ({ resolve: resolveModel, modelsFor, available: () => true }),
}));
vi.mock("../../../shared/ui/Popover", async () => ({
  ...(await vi.importActual<typeof import("../../../shared/ui/Popover")>(
    "../../../shared/ui/Popover",
  )),
  Popover: ({ children }: { children: ReactNode }) =>
    createElement("div", { role: "dialog" }, children),
}));
import { encodeAdvisor, encodeSubagents } from "../../../shared/model/host-contracts/delegation";
import { ModelExtras } from "./ModelExtras";
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetHarnessModelOverlays();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  localStorage.clear();
  resetDisabledModels();
  resetHarnessModelOverlays();
});
it("keeps subagent force inactive until a model is selected and resets extras only", () => {
  const onChange = vi.fn();
  act(() =>
    root.render(
      createElement(ModelExtras, {
        harness: "claude",
        model: "claude:sonnet-5",
        values: {},
        onSettingsChange: onChange,
      }),
    ),
  );
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Extras"]')!.click());
  expect(
    container.querySelector<HTMLSelectElement>('[aria-label="Subagent model policy"]')!.disabled,
  ).toBe(true);
  act(() =>
    root.render(
      createElement(ModelExtras, {
        harness: "claude",
        model: "claude:sonnet-5",
        values: { advisor: "opus", subagentModel: "haiku" },
        onSettingsChange: onChange,
      }),
    ),
  );
  expect(
    container.querySelector<HTMLSelectElement>('[aria-label="Subagent model policy"]')!.disabled,
  ).toBe(false);
  act(() =>
    [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => b.textContent === "Reset extras")!
      .click(),
  );
  expect(onChange).toHaveBeenLastCalledWith({
    advisor: "default",
    subagentModel: "default",
    subagentPolicy: "fallback",
    autoCompact: "default",
    autoCompactWindow: "default",
  });
});
it("shows Claude auto-compact controls and disables the window while auto-compact is off", () => {
  const onChange = vi.fn();
  const render = (values: Record<string, string>) =>
    act(() =>
      root.render(
        createElement(ModelExtras, {
          harness: "claude",
          model: "claude:sonnet-5",
          values,
          onSettingsChange: onChange,
        }),
      ),
    );
  render({});
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Extras"]')!.click());
  expect(container.textContent).toContain("Context");
  const window = () =>
    container.querySelector<HTMLSelectElement>('[aria-label="Auto-compact window"]')!;
  expect(window().disabled).toBe(false);
  const mode = container.querySelector<HTMLSelectElement>('[aria-label="Auto-compact"]')!;
  act(() => {
    mode.value = "off";
    mode.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ autoCompact: "off" }));
  render({ autoCompact: "off", autoCompactWindow: "500000" });
  expect(window().disabled).toBe(true);
  expect(container.querySelector('[aria-label="Extras"]')!.textContent).toContain("1");
});
it("offers only the provider catalog options and removes unsupported settings from updates", () => {
  setHarnessModels("codex", [
    {
      id: "codex:test",
      harness: "codex",
      name: "Test",
      settings: [
        {
          id: "reasoningEffort",
          label: "Reasoning",
          kind: "select",
          value: "medium",
          options: [
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" },
          ],
        },
      ],
    },
  ]);
  const onChange = vi.fn();
  act(() =>
    root.render(
      createElement(ModelExtras, {
        harness: "codex",
        model: "codex:test",
        values: { advisor: "opus", subagentModel: "haiku" },
        onSettingsChange: onChange,
      }),
    ),
  );
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Extras"]')!.click());
  expect(container.querySelector('[aria-label="Advisor"]')).not.toBeNull();
  const select = container.querySelector<HTMLSelectElement>('[aria-label="Reasoning"]')!;
  act(() => {
    select.value = "high";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(onChange).toHaveBeenLastCalledWith({
    reasoningEffort: "high",
    autoCompactWindow: "default",
  });
  act(() =>
    root.render(
      createElement(ModelExtras, {
        harness: "hermes",
        model: "hermes:default",
        values: {},
        onSettingsChange: onChange,
      }),
    ),
  );
  // A provider without catalog settings still offers the any-provider delegation rows.
  expect(container.querySelector('[aria-label="Extras"]')).not.toBeNull();
});

it("offers enabled Claude models in unified advisor choices", () => {
  setHarnessModels("claude", [
    { id: "claude:sonnet-5", harness: "claude", name: "Sonnet 5", nativeId: "sonnet-5" },
    { id: "claude:opus-5", harness: "claude", name: "Opus 5", nativeId: "opus-5" },
    { id: "claude:haiku", harness: "claude", name: "Haiku", nativeId: "haiku" },
  ]);
  saveModelEnabled("claude:haiku", false);
  act(() =>
    root.render(
      createElement(ModelExtras, {
        harness: "claude",
        model: "claude:sonnet-5",
        values: {},
        onSettingsChange: vi.fn(),
      }),
    ),
  );
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Extras"]')!.click());
  const advisor = container.querySelector<HTMLButtonElement>('[aria-label="Advisor"]')!;
  act(() => advisor.click());
  const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
  expect(options.some((o) => o.textContent?.includes("Opus 5"))).toBe(true);
  expect(options.some((o) => o.textContent?.includes("Haiku"))).toBe(false);
  expect(container.querySelector('[aria-label="Subagent model"]')).toBeNull();
});

it("retains the saved accountless advisor value in the native select", () => {
  const model = { id: "codex:gpt-6-astra", harness: "codex" as const, name: "GPT-6-Astra" };
  setHarnessModels("codex", [model]);
  const crossAdvisor = encodeAdvisor({ harness: "codex", model: model.id })!;
  const onChange = vi.fn();
  act(() =>
    root.render(
      createElement(ModelExtras, {
        harness: "codex",
        model: model.id,
        values: { crossAdvisor },
        onSettingsChange: onChange,
      }),
    ),
  );
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Extras"]')!.click());
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Advisor"]')!;
  expect(trigger.textContent).toContain("GPT-6-Astra");
  act(() => trigger.click());
  const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
  const selected = options.find((option) => option.getAttribute("aria-selected") === "true");
  expect(selected?.textContent).toContain("GPT-6-Astra");
  expect(selected?.textContent).toContain("Default");
  expect(options.some((option) => option.textContent?.includes("Unavailable"))).toBe(false);
  expect(onChange).not.toHaveBeenCalled();
});

it("offers the any-provider subagents row for any harness and writes the picked models as one list", () => {
  setHarnessModels("codex", [
    { id: "codex:gpt-6.1-sol", harness: "codex", name: "GPT 6.1 Sol", nativeId: "gpt-6.1-sol" },
  ]);
  setHarnessModels("cursor", [
    { id: "cursor:composer-2", harness: "cursor", name: "Composer 2", nativeId: "composer-2" },
  ]);
  const onChange = vi.fn();
  act(() =>
    root.render(
      createElement(ModelExtras, {
        harness: "codex",
        model: "codex:gpt-6.1-sol",
        values: {},
        onSettingsChange: onChange,
      }),
    ),
  );
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Extras"]')!.click());
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Subagents"]')!;
  expect(trigger.textContent).toContain("Off");
  act(() => trigger.click());
  const composer = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]'),
  ].find((item) => item.textContent?.includes("Composer 2"))!;
  act(() => composer.click());
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      crossSubagents: encodeSubagents([{ harness: "cursor", model: "cursor:composer-2" }]),
    }),
  );
});

it("clears a legacy advisor and records explicit Off", async () => {
  setHarnessModels("claude", [
    { id: "claude:sonnet-5", harness: "claude", name: "Sonnet 5", nativeId: "sonnet-5" },
  ]);
  const onChange = vi.fn();
  act(() =>
    root.render(
      createElement(ModelExtras, {
        harness: "claude",
        model: "claude:sonnet-5",
        values: { advisor: "opus" },
        onSettingsChange: onChange,
      }),
    ),
  );
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Extras"]')!.click());
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Advisor"]')!.click());
  const off = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (option) =>
      option.getAttribute("aria-selected") !== "true" &&
      /^\s*(Off|Default|None)/.test(option.textContent ?? ""),
  )!;
  act(() => off.click());
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ crossAdvisor: "null", advisor: "off" }),
  );
});
