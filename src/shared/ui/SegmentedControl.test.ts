// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { SegmentedControl } from "./SegmentedControl";

it.each(["claude", "opencode"])(
  "renders real %s effort options with longest locale labels outside cells and keyboard selection",
  async (provider) => {
    const source = readFileSync(
      "src/integrations/harness/providers/claude/claudeCatalog.ts",
      "utf8",
    );
    const block = source.split("const EFFORT_WITH_XHIGH")[1].split("const EFFORT_OPUS_47")[0];
    const openCode = readFileSync(
      "src/integrations/harness/providers/opencode/opencodeProtocol.ts",
      "utf8",
    );
    const variantLabels = JSON.parse(
      "{" +
        openCode
          .split("const VARIANT_LABELS: Record<string, string> = {")[1]
          .split("};")[0]
          .replace(/([a-z]+):/g, '"$1":')
          .replace(/,\s*$/, "") +
        "}",
    ) as Record<string, string>;
    const labels =
      provider === "claude"
        ? [
            "Automatic",
            ...Array.from(block.matchAll(/label: "([^"]+)"/g), (match) => match[1]).filter(
              (label) => label !== "Reasoning",
            ),
          ]
        : ["Automatic", ...Object.values(variantLabels)];
    expect(labels).toHaveLength(provider === "claude" ? 8 : 10);
    const catalogs = ["en", "tr", "de", "fr", "es", "pt", "zh-CN", "ja"].map(
      (locale) =>
        JSON.parse(readFileSync(`src/shared/i18n/locales/${locale}.json`, "utf8")) as Record<
          string,
          string
        >,
    );
    const options = labels.map((label, index) => ({
      value: String(index),
      label: catalogs
        .map((catalog) => catalog[label] ?? label)
        .sort((a, b) => b.length - a.length)[0],
      icon: createElement("svg", { "aria-hidden": true }),
      iconOnly: true,
    }));
    const node = document.createElement("div");
    document.body.append(node);
    const root = createRoot(node);
    const change = vi.fn();
    try {
      await act(async () =>
        root.render(
          createElement(SegmentedControl, {
            compact: true,
            options,
            value: "0",
            onValueChange: change,
            label: "Effort",
          }),
        ),
      );
      const cells = [...node.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
      expect(cells).toHaveLength(labels.length);
      for (const [index, cell] of cells.entries()) {
        expect(cell.textContent).toBe("");
        expect(cell.getAttribute("aria-label")).toBe(options[index].label);
      }
      for (const [index, key, next] of [
        [0, "ArrowRight", "1"],
        [1, "ArrowLeft", "0"],
        [0, "End", String(labels.length - 1)],
        [labels.length - 1, "Home", "0"],
        [labels.length - 1, "ArrowRight", "0"],
      ] as const) {
        await act(async () =>
          cells[index].dispatchEvent(
            new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
          ),
        );
        expect(change).toHaveBeenLastCalledWith(next);
        expect(document.activeElement).toBe(cells[Number(next)]);
      }
    } finally {
      await act(async () => root.unmount());
      node.remove();
    }
  },
);
