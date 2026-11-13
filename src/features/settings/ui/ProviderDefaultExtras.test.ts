// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ProviderDefaultExtras } from "./ProviderDefaultExtras";
import { CLAUDE_COMPACT_SETTINGS } from "../../sessions/model/claudeCompact";
import { encodeAdvisor } from "../../../shared/model/host-contracts/delegation";

it("keeps the saved threshold while inherited auto-compaction is off", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const change = vi.fn();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const render = (autoCompact: string) =>
    act(() =>
      root.render(
        createElement(ProviderDefaultExtras, {
          extras: CLAUDE_COMPACT_SETTINGS,
          harness: "claude",
          inheritedDefaults: { extras: { autoCompact } },
          scopeDefaults: { extras: { autoCompactWindow: "500000" } },
          projectScope: true,
          resetLabel: "Use global default",
          onSessionDefaultsChange: change,
        }),
      ),
    );
  render("off");
  const threshold = () =>
    container.querySelector<HTMLButtonElement>(
      '[aria-label^="Claude Code default Auto-compact window:"]',
    )!;
  expect(threshold().disabled).toBe(true);
  expect(threshold().textContent).toContain("500K");
  expect(change).not.toHaveBeenCalled();
  render("on");
  expect(threshold().disabled).toBe(false);
  expect(threshold().textContent).toContain("500K");
  const off =
    container.querySelector<HTMLButtonElement>('[role="radio"][aria-label="Off"]') ??
    Array.from(container.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(
      (button) => button.textContent === "Off",
    );
  expect(off).toBeTruthy();
  act(() => off!.click());
  expect(change).toHaveBeenCalledWith({
    extras: { autoCompactWindow: "500000", autoCompact: "off" },
  });
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

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
        scopeDefaults: { effort: "low", extras: { crossSubagentMaxEffort: "high" } },
        inheritedDefaults: { extras: { crossSubagentMaxEffort: "max" } },
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
              { value: "none", label: "None" },
              { value: "minimal", label: "Minimal" },
              { value: "low", label: "Low" },
              { value: "high", label: "High" },
              { value: "max", label: "Max" },
            ],
          },
        ],
      }),
    ),
  );
  const radios = [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  expect(radios.map((option) => option.getAttribute("aria-label"))).toEqual(["Low", "High", "Max"]);
  expect(radios[1].getAttribute("aria-checked")).toBe("true");
  const max = radios[2];
  expect(max).not.toBeNull();
  act(() => max!.click());
  expect(change).toHaveBeenLastCalledWith({
    effort: "low",
    extras: { crossSubagentMaxEffort: "max" },
  });
  const automatic = container.querySelector<HTMLButtonElement>('[role="switch"]')!;
  expect(automatic.getAttribute("aria-checked")).toBe("false");
  act(() => automatic.click());
  expect(change).toHaveBeenLastCalledWith({
    effort: "low",
    extras: { crossSubagentMaxEffort: "" },
  });
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("offers Automatic / Custom / Off for unset subagent defaults", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const change = vi.fn();
  act(() =>
    root.render(
      createElement(ProviderDefaultExtras, {
        harness: "codex",
        scopeDefaults: {},
        projectScope: false,
        resetLabel: "Reset",
        onSessionDefaultsChange: change,
        extras: [
          {
            id: "crossSubagents",
            label: "Subagents",
            kind: "select",
            value: "",
            options: [
              { value: "", label: "Off" },
              { value: "auto", label: "Automatic" },
            ],
          },
        ],
      }),
    ),
  );
  expect([...container.querySelectorAll('[role="radio"]')].map((node) => node.textContent)).toEqual(
    ["Automatic", "Custom", "Off"],
  );
  expect(container.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe(
    "Automatic",
  );
  expect(change).not.toHaveBeenCalled();
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

it.each([undefined, "auto", "[]"])(
  "stores panel wire values from %s and keeps Custom pending until selection",
  (initial) => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const change = vi.fn();
    const ref = { harness: "codex" as const, model: "codex:test", providerAccountId: "default" };
    const option = encodeAdvisor(ref)!;
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const render = (value: string | undefined) =>
      act(() =>
        root.render(
          createElement(ProviderDefaultExtras, {
            harness: "codex",
            scopeDefaults: {
              effort: "low",
              extras: value === undefined ? {} : { crossSubagents: value },
            },
            projectScope: true,
            resetLabel: "Reset",
            onSessionDefaultsChange: change,
            extras: [
              {
                id: "crossSubagents",
                label: "Subagents",
                kind: "select",
                value: "",
                options: [
                  { value: "", label: "Off" },
                  { value: "auto", label: "Automatic" },
                  { value: option, label: "Codex · Test" },
                ],
              },
            ],
          }),
        ),
      );
    const mode = (label: string) =>
      [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
        (node) => node.textContent === label,
      )!;
    render(initial);
    expect(mode(initial === "[]" ? "Off" : "Automatic").getAttribute("aria-checked")).toBe("true");
    act(() => mode("Custom").click());
    expect(change).not.toHaveBeenCalled();
    act(() => container.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!.click());
    expect(
      [...document.querySelectorAll('[role="option"]')].map((node) => node.textContent).join(" "),
    ).not.toContain("Automatic");
    const model = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((node) =>
      node.textContent?.includes("Test"),
    )!;
    act(() => model.click());
    const wire = JSON.stringify([ref]);
    expect(change).toHaveBeenLastCalledWith({ effort: "low", extras: { crossSubagents: wire } });
    render(wire);
    expect(mode("Custom").getAttribute("aria-checked")).toBe("true");
    act(() => mode("Off").click());
    expect(change).toHaveBeenLastCalledWith({ effort: "low", extras: { crossSubagents: "[]" } });
    render("[]");
    expect(mode("Off").getAttribute("aria-checked")).toBe("true");
    act(() => mode("Automatic").click());
    expect(change).toHaveBeenLastCalledWith({ effort: "low", extras: { crossSubagents: "auto" } });
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  },
);

it.each(["auto", "[]", JSON.stringify([{ harness: "codex", model: "codex:test" }])])(
  "follows inherited subagent value %s and resets saved and legacy overrides",
  (inherited) => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const change = vi.fn();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const extras = [
      {
        id: "crossSubagents",
        label: "Subagents",
        kind: "select" as const,
        value: "",
        options: [
          { value: "", label: "Off" },
          { value: "auto", label: "Automatic" },
          {
            value: encodeAdvisor({ harness: "codex", model: "codex:test" })!,
            label: "Codex · Test",
          },
        ],
      },
    ];
    const render = (saved: Record<string, string>) =>
      act(() =>
        root.render(
          createElement(ProviderDefaultExtras, {
            harness: "claude",
            scopeDefaults: { extras: saved },
            inheritedDefaults: { extras: { crossSubagents: inherited } },
            projectScope: true,
            resetLabel: "Reset subagents",
            onSessionDefaultsChange: change,
            extras,
          }),
        ),
      );
    render({});
    expect(container.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe(
      inherited === "auto" ? "Automatic" : inherited === "[]" ? "Off" : "Custom",
    );
    expect(change).not.toHaveBeenCalled();
    render({ crossSubagents: "[]", subagentModel: "sonnet", fast: "true" });
    act(() =>
      container.querySelector<HTMLButtonElement>('[aria-label="Reset subagents"]')!.click(),
    );
    expect(change).toHaveBeenLastCalledWith({ extras: { fast: "true" } });
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  },
);

it("offers one Automatic entry without redundant wand decoration in extras", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  try {
    act(() =>
      root.render(
        createElement(ProviderDefaultExtras, {
          harness: "claude",
          scopeDefaults: {},
          projectScope: false,
          resetLabel: "Reset",
          onSessionDefaultsChange: vi.fn(),
          extras: [
            {
              id: "custom",
              label: "Custom extra",
              kind: "select",
              value: "",
              options: [
                { value: "", label: "Automatic" },
                { value: "custom", label: "Custom" },
              ],
            },
          ],
        }),
      ),
    );
    const trigger = node.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!;
    expect(trigger.querySelectorAll("svg")).toHaveLength(1); // Shared chevron only.
    act(() => trigger.click());
    expect(
      [...document.querySelectorAll('[role="option"]')].filter(
        (option) => option.textContent?.trim() === "Automatic",
      ),
    ).toHaveLength(1);
  } finally {
    act(() => root.unmount());
    node.remove();
    vi.unstubAllGlobals();
  }
});
