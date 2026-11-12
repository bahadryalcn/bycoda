import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sheets = [
  ["arc/context-menu/context-menu.module.css", "item"],
  ["arc/select/select.module.css", "item"],
  ["arc/combobox/combobox.module.css", "choice|option"],
  ["arc/morph-select/morph-select.module.css", "option|highlight"],
  ["arc/expanding-search/expanding-search.module.css", "option|highlight"],
  ["picker/picker.module.css", "row"],
  ["../../styles/arc.css", "bycoda-arc-select-option"],
] as const;

describe("popup choice surfaces", () => {
  it.each(sheets)("%s never frames an option row in any state", (file, names) => {
    const css = readFileSync(join(__dirname, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const row = new RegExp(`\\.(?:${names})(?![\\w-])`);
    const frames: string[] = [];
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!row.test(selector) || /\s>\s/.test(selector)) continue;
      for (const [, property, value] of body.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)) {
        if (
          /^(?:border(?!-radius)(?:-[\w-]+)?|outline(?:-(?:width|color|style))?|box-shadow)$/.test(
            property,
          ) &&
          !/^(?:0(?:px)?|none|transparent)(?:\s*!important)?$/.test(value.trim())
        ) {
          frames.push(`${selector.trim()}: ${property}: ${value}`);
        }
      }
    }
    expect(frames).toEqual([]);
  });

  it("normalizes semantic options without removing container or input focus", () => {
    const css = readFileSync(join(__dirname, "../../styles/arc.css"), "utf8");
    const reset = css.match(/:root :is\(\s*\[role="option"\][\s\S]*?\{([^}]+)\}/)?.[1];
    expect(reset).toBeDefined();
    expect(reset).toContain("border: 0 !important;");
    expect(reset).toContain("outline: none !important;");
    expect(reset).toContain("box-shadow: none !important;");
    for (const role of ["option", "menuitem", "menuitemradio", "menuitemcheckbox"]) {
      expect(css.match(/:root :is\(\s*\[role="option"\][\s\S]*?\{/)?.[0]).toContain(
        `[role="${role}"]`,
      );
    }
    const arc = readFileSync(join(__dirname, "../../styles/arc.css"), "utf8");
    expect(arc).toContain("outline: var(--ui-focus-width) solid var(--ui-focus-ring-color)");
    const picker = readFileSync(join(__dirname, "picker/picker.module.css"), "utf8");
    expect(picker).toMatch(/\.list\.list:focus-visible\s*\{\s*box-shadow: inset/);
  });
});
