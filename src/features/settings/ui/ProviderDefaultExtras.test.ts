// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ProviderDefaultExtras } from "./ProviderDefaultExtras";
import { CLAUDE_COMPACT_SETTINGS } from "../../sessions/model/claudeCompact";
import { encodeAdvisor } from "../../../shared/model/host-contracts/delegation";

it("hides the window while inherited auto-compaction is off and keeps its saved value", () => {
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
          resetLabel: "Use global default",
          onSessionDefaultsChange: change,
        }),
      ),
    );
  render("off");
  const threshold = () =>
    container.querySelector<HTMLButtonElement>(
      '[aria-label^="Claude Code default Auto-compact window:"]',
    );
  expect(threshold()).toBeNull();
  expect(change).not.toHaveBeenCalled();
  render("on");
  expect(threshold()!.textContent).toContain("500K tokens");
  // One row holds both: the window sits beside the mode, not in a row of its own.
  expect(container.querySelectorAll('[data-settings-part="row"]')).toHaveLength(1);
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
        inheritedDefaults: { extras: { crossAdvisor: advisor } },
        resetLabel: "Use global default",
        onSessionDefaultsChange: change,
      }),
    ),
  );
  expect(container.querySelector('[role="switch"]')!.getAttribute("aria-checked")).toBe("false");
  const reset = container.querySelector<HTMLButtonElement>('[aria-label="Use global default"]');
  expect(reset).not.toBeNull();
  act(() => reset!.click());
  expect(change).toHaveBeenCalledWith({ extras: {} });
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it.each(["Reset to automatic", "Use Bycoda defaults"])(
  "shows inherited product advisor without saving it (reset: %s)",
  (resetLabel) => {
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
          inheritedDefaults: { extras: { crossAdvisor: advisor } },
          resetLabel,
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

it("persists advisor Off and removes legacy advisor when the switch turns off", () => {
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
            // The legacy "opus" value resolves to this advisor.
            value: advisor,
            options: [
              { value: "", label: "Off" },
              { value: advisor, label: "Claude Code · Opus" },
            ],
          },
        ],
        harness: "claude",
        scopeDefaults: { extras: { advisor: "opus" } },
        inheritedDefaults: {},
        resetLabel: "Use global default",
        onSessionDefaultsChange: change,
      }),
    ),
  );
  const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!;
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  act(() => toggle.click());
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

it("turns Automatic off when a ceiling bar is chosen", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const change = vi.fn();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  act(() =>
    root.render(
      createElement(ProviderDefaultExtras, {
        harness: "claude",
        scopeDefaults: { extras: {} },
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
              { value: "low", label: "Low" },
              { value: "high", label: "High" },
            ],
          },
        ],
      }),
    ),
  );
  const automatic = container.querySelector<HTMLButtonElement>('[role="switch"]')!;
  expect(automatic.getAttribute("aria-checked")).toBe("true");
  const high = container.querySelector<HTMLButtonElement>('[role="radio"][aria-label="High"]')!;
  expect(high.disabled).toBe(false);
  act(() => high.click());
  expect(change).toHaveBeenLastCalledWith({ extras: { crossSubagentMaxEffort: "high" } });
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("reads the inherited auto-compact segment as Default (On), not a second On", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  act(() =>
    root.render(
      createElement(ProviderDefaultExtras, {
        extras: CLAUDE_COMPACT_SETTINGS,
        harness: "claude",
        inheritedDefaults: { extras: { autoCompact: "on" } },
        scopeDefaults: {},
        resetLabel: "Use global default",
        onSessionDefaultsChange: vi.fn(),
      }),
    ),
  );
  const labels = Array.from(container.querySelectorAll('[role="radio"]')).map(
    (button) => button.textContent,
  );
  expect(labels).toEqual(["Default (On)", "On", "Off"]);
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("names an unavailable inherited advisor in the select label without a separate badge", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
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
              { value: advisor, label: "Unavailable: Claude Code · Opus" },
            ],
          },
        ],
        harness: "claude",
        scopeDefaults: {},
        inheritedDefaults: { extras: { crossAdvisor: advisor } },
        resetLabel: "Use Bycoda defaults",
        onSessionDefaultsChange: vi.fn(),
      }),
    ),
  );
  const select = container.querySelector<HTMLButtonElement>(
    '[aria-haspopup="dialog"][aria-label^="Advisor model"]',
  )!;
  // The unavailable state is carried by the option's own label; no label-parsing badge is added.
  expect(select.textContent).toContain("Unavailable: Claude Code · Opus");
  expect(container.querySelectorAll('[data-tone="warning"]')).toHaveLength(0);
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function mount(props: Partial<Parameters<typeof ProviderDefaultExtras>[0]>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const change = vi.fn();
  const render = (next: Partial<Parameters<typeof ProviderDefaultExtras>[0]> = {}) =>
    act(() =>
      root.render(
        createElement(ProviderDefaultExtras, {
          extras: [],
          harness: "codex",
          scopeDefaults: {},
          resetLabel: "Reset",
          onSessionDefaultsChange: change,
          ...props,
          ...next,
        }),
      ),
    );
  render();
  const radios = () =>
    [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')].map(
      (node) => node.textContent,
    );
  const done = () => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  };
  return { container, change, render, radios, done };
}

const tiers = (...values: [string, string][]) => [
  {
    id: "serviceTier",
    label: "Service tier",
    kind: "select" as const,
    value: "default",
    options: values.map(([value, label]) => ({ value, label })),
  },
];

it("offers every service tier with its own name, as segments while they fit", () => {
  const view = mount({
    extras: tiers(["default", "Standard"], ["priority", "Fast"], ["ultrafast", "Ultrafast"]),
  });
  try {
    expect(view.container.textContent).toContain("Service tier");
    expect(view.radios()).toEqual(["Automatic", "Standard", "Fast", "Ultrafast"]);
    act(() =>
      [...view.container.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
        .find((node) => node.textContent === "Ultrafast")!
        .click(),
    );
    expect(view.change).toHaveBeenLastCalledWith({ extras: { serviceTier: "ultrafast" } });
  } finally {
    view.done();
  }
});

it("uses a select when the tiers do not fit one segmented row", () => {
  const view = mount({
    extras: tiers(
      ["default", "Standard"],
      ["flex", "Flex"],
      ["priority", "Fast"],
      ["ultrafast", "Ultrafast"],
    ),
  });
  try {
    expect(view.radios()).toEqual([]);
    const trigger = view.container.querySelector<HTMLButtonElement>(
      '[aria-label^="Codex default Service tier"]',
    )!;
    act(() => trigger.click());
    expect(
      [...document.querySelectorAll('[role="option"]')].map((node) => node.textContent?.trim()),
    ).toEqual(["Automatic", "Standard", "Flex", "Fast", "Ultrafast"]);
  } finally {
    view.done();
  }
});

it("keeps a saved Claude default auto-compact visible and offers the window beside it", () => {
  const view = mount({
    extras: CLAUDE_COMPACT_SETTINGS,
    harness: "claude",
    scopeDefaults: { extras: { autoCompact: "default" } },
  });
  try {
    expect(view.radios()).toEqual(["Automatic", "Claude default", "On", "Off"]);
    expect(
      view.container.querySelector('[aria-label^="Claude Code default Auto-compact window:"]'),
    ).not.toBeNull();
    act(() => view.container.querySelector<HTMLButtonElement>('[aria-label="Reset"]')!.click());
    expect(view.change).toHaveBeenLastCalledWith({ extras: {} });
  } finally {
    view.done();
  }
});

it("turns image models off and back to Automatic", () => {
  const images = [
    {
      id: "imageModels",
      label: "Image models",
      kind: "select" as const,
      value: "",
      options: [
        { value: "", label: "Automatic" },
        { value: "codex", label: "Codex ImageGen" },
        { value: "antigravity", label: "Nano Banana (Antigravity)" },
      ],
    },
  ];
  const view = mount({ extras: images });
  try {
    const segment = (label: string) =>
      [...view.container.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
        (node) => node.textContent === label,
      )!;
    expect(view.radios()).toEqual(["Automatic", "Custom", "Off"]);
    act(() => segment("Off").click());
    expect(view.change).toHaveBeenLastCalledWith({ extras: { imageModels: "[]" } });
    view.render({ scopeDefaults: { extras: { imageModels: "[]" } } });
    act(() => segment("Automatic").click());
    expect(view.change).toHaveBeenLastCalledWith({ extras: {} });
  } finally {
    view.done();
  }
});

it("explains an unavailable advisor below the row and how to fix it", () => {
  const advisor = encodeAdvisor({ harness: "opencode", model: "opencode:sonnet" })!;
  const { container, done } = mount({
    harness: "claude",
    extras: [
      {
        id: "crossAdvisor",
        label: "Advisor",
        kind: "select",
        value: "",
        options: [
          { value: "", label: "Off" },
          { value: advisor, label: "Unavailable: OpenCode · Claude Sonnet 5", unavailable: true },
        ],
      } as Parameters<typeof ProviderDefaultExtras>[0]["extras"][number],
    ],
    scopeDefaults: { extras: { crossAdvisor: advisor } },
  });
  expect(container.textContent).toContain(
    "This advisor model is unavailable, so the advisor is not used.",
  );
  done();
});
