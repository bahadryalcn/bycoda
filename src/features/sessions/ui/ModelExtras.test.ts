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
  useModelSource: () => ({ resolve: resolveModel, modelsFor }),
}));
vi.mock("../../../shared/ui/Popover", () => ({
  Popover: ({ children }: { children: ReactNode }) =>
    createElement("div", { role: "dialog" }, children),
}));
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
  const select = container.querySelector<HTMLSelectElement>('[aria-label="Subagent model"]')!;
  act(() => {
    select.value = "haiku";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ subagentModel: "haiku" }));
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
  expect(container.querySelector('[aria-label="Advisor"]')).toBeNull();
  const select = container.querySelector<HTMLSelectElement>('[aria-label="Reasoning"]')!;
  act(() => {
    select.value = "high";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(onChange).toHaveBeenLastCalledWith({ reasoningEffort: "high" });
  act(() =>
    root.render(
      createElement(ModelExtras, {
        harness: "gemini",
        model: "gemini:default",
        values: {},
        onSettingsChange: onChange,
      }),
    ),
  );
  expect(container.querySelector("button")).toBeNull();
});

it("shows versioned Claude models and forwards their full IDs without changing the main model", () => {
  setHarnessModels("claude", [
    {
      id: "claude:sonnet-5",
      harness: "claude",
      name: "Sonnet 5",
      nativeId: "claude-sonnet-5",
    },
    {
      id: "claude:opus-5-5",
      harness: "claude",
      name: "Opus 5.5",
      nativeId: "claude-opus-5-5",
    },
    {
      id: "claude:opus-4.5",
      harness: "claude",
      name: "Opus 4.5",
      nativeId: "claude-opus-4-5",
    },
    {
      id: "claude:haiku-4.5",
      harness: "claude",
      name: "Haiku 4.5",
      nativeId: "claude-haiku-4-5",
    },
  ]);
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
  const advisor = container.querySelector<HTMLSelectElement>('[aria-label="Advisor"]')!;
  expect([...advisor.options].map((o) => o.text)).toContain("Opus 5.5");
  expect([...advisor.options].map((o) => o.value)).not.toContain("claude-opus-4-5");
  expect([...advisor.options].find((o) => o.value === "opus")!.text).toBe("Opus");
  expect([...advisor.options].find((o) => o.value === "default")!.text).toBe("Claude default");
  act(() => {
    advisor.value = "claude-opus-5-5";
    advisor.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ advisor: "claude-opus-5-5" }),
  );
  const subagent = container.querySelector<HTMLSelectElement>('[aria-label="Subagent model"]')!;
  expect([...subagent.options].map((o) => o.text)).toContain("Haiku 4.5");
  act(() => {
    subagent.value = "claude-haiku-4-5";
    subagent.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ subagentModel: "claude-haiku-4-5" }),
  );
  expect(resolveModel("claude", "claude:sonnet-5").nativeId).toBe("claude-sonnet-5");
});

it("hides turned-off Claude models and labels aliases with their live version", () => {
  setHarnessModels("claude", [
    { id: "claude:opus", harness: "claude", name: "Opus 5.5", nativeId: "opus" },
    {
      id: "claude:sonnet",
      harness: "claude",
      name: "Sonnet 5.5 (1M context)",
      nativeId: "sonnet",
    },
    { id: "claude:fable", harness: "claude", name: "Fable 5.1", nativeId: "fable" },
    { id: "claude:haiku", harness: "claude", name: "Haiku 4.5", nativeId: "haiku" },
    {
      id: "claude:opus-4-8",
      harness: "claude",
      name: "Opus 4.8",
      nativeId: "claude-opus-4-8",
    },
  ]);
  saveModelEnabled("claude:haiku", false);
  saveModelEnabled("claude:opus-4-8", false);
  act(() =>
    root.render(
      createElement(ModelExtras, {
        harness: "claude",
        model: "claude:opus",
        values: {},
        onSettingsChange: vi.fn(),
      }),
    ),
  );
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Extras"]')!.click());
  const subagent = container.querySelector<HTMLSelectElement>('[aria-label="Subagent model"]')!;
  expect([...subagent.options].map((o) => o.text)).toEqual([
    "Claude default",
    "Sonnet 5.5",
    "Opus 5.5",
    "Fable 5.1",
  ]);
  const advisor = container.querySelector<HTMLSelectElement>('[aria-label="Advisor"]')!;
  expect([...advisor.options].map((o) => o.text)).toEqual([
    "Claude default",
    "Off",
    "Opus 5.5",
    "Fable 5.1",
  ]);
});
