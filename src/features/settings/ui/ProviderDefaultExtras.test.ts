// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ProviderDefaultExtras } from "./ProviderDefaultExtras";
import { encodeAdvisor } from "../../../shared/model/host-contracts/delegation";

it("shows saved legacy advisor Off ahead of inherited product defaults and resets both keys", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const change = vi.fn();
  const advisor = encodeAdvisor({ harness: "claude", model: "claude:opus" })!;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  act(() =>
    root.render(
      createElement(ProviderDefaultExtras, {
        extras: [
          {
            id: "crossAdvisor",
            label: "Advisor",
            kind: "select",
            value: "",
            options: [
              { value: "", label: "Off" },
              { value: advisor, label: "Opus 5.5" },
            ],
          },
        ],
        harness: "claude",
        scopeDefaults: { extras: { advisor: "off" } },
        projectScope: false,
        inheritedDefaults: { extras: { crossAdvisor: advisor } },
        resetLabel: "Use global default",
        onSessionDefaultsChange: change,
      }),
    ),
  );
  expect(container.textContent).toContain("Off");
  const reset = container.querySelector<HTMLButtonElement>('[aria-label="Use global default"]');
  expect(reset).not.toBeNull();
  act(() => reset!.click());
  expect(change).toHaveBeenCalledWith({ extras: {} });
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it.each([false, true])(
  "shows inherited product advisor without saving it (scoped: %s)",
  (projectScope) => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const change = vi.fn();
    const advisor = encodeAdvisor({ harness: "codex", model: "codex:gpt-6.1-sol" })!;
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    act(() =>
      root.render(
        createElement(ProviderDefaultExtras, {
          extras: [
            {
              id: "crossAdvisor",
              label: "Advisor",
              kind: "select",
              value: "",
              options: [
                { value: "", label: "Off" },
                { value: advisor, label: "Codex · GPT-6.1 Sol" },
              ],
            },
          ],
          harness: "codex",
          scopeDefaults: {},
          projectScope,
          inheritedDefaults: { extras: { crossAdvisor: advisor } },
          resetLabel: "Use global default",
          onSessionDefaultsChange: change,
        }),
      ),
    );
    expect(container.textContent).toContain("GPT-6.1 Sol");
    expect(container.textContent).not.toContain("Off");
    expect(change).not.toHaveBeenCalled();
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  },
);

it("persists advisor Off and removes legacy advisor on selection", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const change = vi.fn();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  act(() =>
    root.render(
      createElement(ProviderDefaultExtras, {
        extras: [
          {
            id: "crossAdvisor",
            label: "Advisor",
            kind: "select",
            value: "",
            options: [{ value: "", label: "Off" }],
          },
        ],
        harness: "claude",
        scopeDefaults: { extras: { advisor: "opus" } },
        projectScope: true,
        inheritedDefaults: {},
        resetLabel: "Use global default",
        onSessionDefaultsChange: change,
      }),
    ),
  );
  act(() =>
    container
      .querySelector<HTMLButtonElement>('[aria-label^="Claude Code default Advisor"]')!
      .click(),
  );
  const off = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
    (node) => node.textContent?.trim() === "Off",
  )!;
  act(() => off.click());
  expect(change).toHaveBeenCalledWith({ extras: { crossAdvisor: "null" } });
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("shows Fast as keyboard accessible scale and keeps explicit Off", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const change = vi.fn();
  act(() =>
    root.render(
      createElement(ProviderDefaultExtras, {
        extras: [
          {
            id: "fast",
            label: "Fast",
            kind: "toggle",
            value: "true",
            options: [
              { value: "true", label: "On" },
              { value: "false", label: "Off" },
            ],
          },
        ],
        harness: "claude",
        scopeDefaults: { extras: { fast: "false" } },
        inheritedDefaults: { extras: { fast: "true" } },
        onSessionDefaultsChange: change,
        projectScope: true,
        resetLabel: "Use global default",
      }),
    ),
  );
  expect(container.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toContain(
    "Standard",
  );
  expect(change).not.toHaveBeenCalled();
  act(() => root.unmount());
  container.remove();
});

it("edits the subagent ceiling as a draft without changing the main effort", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const change = vi.fn();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  act(() =>
    root.render(
      createElement(ProviderDefaultExtras, {
        harness: "claude",
        scopeDefaults: { effort: "low" },
        projectScope: false,
        resetLabel: "Reset",
        onSessionDefaultsChange: change,
        extras: [
          {
            id: "crossSubagentMaxEffort",
            label: "Subagent max effort",
            kind: "select",
            value: "",
            options: [
              { value: "", label: "Automatic" },
              { value: "max", label: "Max" },
            ],
          },
        ],
      }),
    ),
  );
  const max = container.querySelector<HTMLButtonElement>('[role="radio"][aria-label="Max"]');
  expect(max).not.toBeNull();
  act(() => max!.click());
  expect(change).toHaveBeenLastCalledWith({
    effort: "low",
    extras: { crossSubagentMaxEffort: "max" },
  });
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
