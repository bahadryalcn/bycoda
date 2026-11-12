// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ProviderDefaultsForm } from "./ProviderDefaultsForm";
import { setHarnessModels } from "../../sessions/public/models";
it("keeps all real Claude effort labels outside the glyph cells", async () => {
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
    const cells = [...node.querySelectorAll<HTMLButtonElement>('.provider-effort [role="radio"]')];
    expect(cells).toHaveLength(8);
    for (const cell of cells) {
      expect(cell.textContent?.match(/[A-Za-zÀ-ž]/)).toBeNull();
      expect(cell.getAttribute("aria-label")).toBeTruthy();
    }
    expect(node.querySelector(".provider-effort-selected")?.textContent).toBe(options[6].label);
  } finally {
    await act(async () => root.unmount());
    node.remove();
  }
});
