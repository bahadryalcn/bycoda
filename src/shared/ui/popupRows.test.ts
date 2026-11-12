import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sheets = [
  ["arc/context-menu/context-menu.module.css", "item"],
  ["arc/combobox/combobox.module.css", "choice|option"],
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

const read = (file: string) =>
  readFileSync(join(__dirname, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rule = (css: string, selector: string) => {
  const start = css.search(new RegExp(String.raw`(^|\})\s*\.${selector.slice(1)}\s*\{`));
  if (start < 0) return "";
  const open = css.indexOf("{", start);
  return css.slice(open + 1, css.indexOf("}", open));
};

describe("popup rows are one line and the popup grows with them", () => {
  it.each([
    ["arc/combobox/combobox.module.css", ".choiceLabel"],
    ["arc/context-menu/context-menu.module.css", ".copy"],
    ["arc/expanding-search/expanding-search.module.css", ".optionTitle"],
  ])("%s %s keeps primary copy on one line", (file, selector) => {
    expect(rule(read(file), selector)).toContain("white-space: nowrap;");
  });

  it("caps the shared list popup at 800px", () => {
    expect(readFileSync(join(__dirname, "../lib/popover.ts"), "utf8")).toContain(
      "export const POPUP_MAX_WIDTH = 800;",
    );
    expect(read("Popover.tsx")).toContain("popupListWidth(naturalWidth, minWidth)");
  });

  it.each([
    "Select.tsx",
    "SearchableSelect.tsx",
    "DropdownMenu.tsx",
    "picker/PickerPopover.tsx",
    "arc/context-menu/native-context-menu.tsx",
    "arc/expanding-search/expanding-search.tsx",
    "arc/combobox/combobox.tsx",
    "arc/context-menu/context-menu.tsx",
  ])("%s pins no list width: its width is the floor", (file) => {
    const source = read(file);
    expect(source).toContain("minWidth=");
    // A list popup never passes a fixed `width` to Popover. Allowed: DropdownMenu's custom `panel` flyout,
    // its own MenuSurface `width` prop (a floor) and an icon size.
    const fixed = [...source.matchAll(/^\s+width=\{(.*)\}$/gm)]
      .map((match) => match[1])
      .filter((value) => !/^(width|open\.submenuWidth \?\? (296|228)|variant ===.*)$/.test(value));
    expect(fixed).toEqual([]);
  });

  it.each([
    "arc/context-menu/context-menu.module.css",
    "arc/combobox/combobox.module.css",
    "arc/select/select.module.css",
  ])("%s duplicates no viewport width cap", (file) => {
    expect(read(file)).not.toContain("800px");
    expect(read(file)).not.toContain("--radix-select-");
  });

  it.each([
    ["arc/combobox/combobox.module.css", ".choiceDescription"],
    ["arc/context-menu/context-menu.module.css", ".description"],
    ["arc/context-menu/context-menu.module.css", ".header"],
    ["arc/expanding-search/expanding-search.module.css", ".optionMeta"],
    ["picker/picker.module.css", ".description"],
  ])("%s %s never sets the popup width", (file, selector) => {
    expect(rule(read(file), selector)).toContain("contain: inline-size;");
  });
});
