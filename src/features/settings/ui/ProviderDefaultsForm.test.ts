// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ProviderDefaultsForm } from "./ProviderDefaultsForm";
import { setHarnessModels } from "../../sessions/public/models";
it("keeps all real Claude effort labels outside the bars", async () => {
  const source = readFileSync("src/integrations/harness/providers/claude/claudeCatalog.ts", "utf8");
  const block = source.split("const EFFORT_WITH_XHIGH")[1].split("const EFFORT_OPUS_47")[0];
  const labels = Array.from(block.matchAll(/label: "([^"]+)"/g), (m) => m[1]).filter(
    (label) => label !== "Reasoning",
  );
  const catalogs = ["en", "tr", "de", "fr", "es", "pt", "zh-CN", "ja"].map(
    (locale) =>
      JSON.parse(readFileSync(`src/shared/i18n/locales/${locale}.json`, "utf8")) as Record<
        string,
        string
      >,
  );
  const options = labels.map((label) => ({
    value: label.toLowerCase(),
    label: catalogs.map((c) => c[label] ?? label).sort((a, b) => b.length - a.length)[0],
  }));
  setHarnessModels("claude", [
    {
      id: "claude:test",
      harness: "claude",
      name: "Opus",
      settings: [{ id: "effort", label: "Effort", kind: "select", value: "high", options }],
    },
  ]);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  try {
    await act(async () =>
      root.render(
        createElement(ProviderDefaultsForm, {
          harness: "claude",
          selectedModel: "claude:test",
          scopeDefaults: { effort: options[6].value },
          onSessionDefaultsChange: vi.fn(),
          onModelChange: vi.fn(),
        }),
      ),
    );
    // The first scale is the model effort; Automatic is its switch, not a bar.
    const cells = [
      ...node
        .querySelector(".provider-effort")!
        .querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    ];
    expect(cells).toHaveLength(labels.length);
    for (const cell of cells) {
      expect(cell.textContent?.match(/[A-Za-zÀ-ž]/)).toBeNull();
      expect(cell.getAttribute("aria-label")).toBeTruthy();
    }
    expect(node.querySelector(".provider-effort")?.textContent).toContain(options[6].label);
  } finally {
    await act(async () => root.unmount());
    node.remove();
    vi.unstubAllGlobals();
  }
});

it("leaves effort to Automatic with the level in effect shown muted, and clears a saved level", async () => {
  const options = ["low", "medium", "high"].map((value) => ({ value, label: value }));
  setHarnessModels("claude", [
    {
      id: "claude:test",
      harness: "claude",
      name: "Opus",
      settings: [{ id: "effort", label: "Effort", kind: "select", value: "medium", options }],
    },
  ]);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  const change = vi.fn();
  const render = (effort?: string) =>
    act(async () =>
      root.render(
        createElement(ProviderDefaultsForm, {
          harness: "claude",
          selectedModel: "claude:test",
          scopeDefaults: effort ? { effort } : {},
          onSessionDefaultsChange: change,
          onModelChange: vi.fn(),
        }),
      ),
    );
  try {
    await render();
    const scale = () => node.querySelector(".provider-effort")!;
    const automatic = () => scale().querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(automatic().getAttribute("aria-checked")).toBe("true");
    expect(scale().querySelectorAll("[data-inherited]")).toHaveLength(2);
    await render("high");
    expect(automatic().getAttribute("aria-checked")).toBe("false");
    await act(async () => automatic().click());
    expect(change).toHaveBeenLastCalledWith({ effort: undefined });
  } finally {
    await act(async () => root.unmount());
    node.remove();
    vi.unstubAllGlobals();
  }
});
