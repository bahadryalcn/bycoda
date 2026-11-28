import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sheets = [
  ["ListRow.module.css", "row"],
  ["arc/context-menu/context-menu.module.css", "item"],
  ["arc/combobox/combobox.module.css", "choice|option"],
  ["arc/expanding-search/expanding-search.module.css", "option|highlight"],
  ["picker/picker.module.css", "row"],
] as const;

describe("popup choice surfaces", () => {
  it.each(sheets)(
    "%s keeps option rows unframed apart from a keyboard focus cue",
    (file, names) => {
      const css = readFileSync(join(__dirname, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      const row = new RegExp(`\\.(?:${names})(?![\\w-])`);
      const frames: string[] = [];
      for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!row.test(selector) || /\s>\s/.test(selector)) continue;
        for (const [, property, value] of body.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)) {
          const disabledChoiceFocus =
            file === "arc/combobox/combobox.module.css" &&
            selector.trim() === '.choice[aria-disabled="true"][data-highlighted]:not(:disabled)' &&
            property === "outline" &&
            value === "var(--ui-focus-width) solid var(--ui-focus-ring-color)";
          if (
            !disabledChoiceFocus &&
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
    },
  );

  it("normalizes semantic options without removing container or input focus", () => {
    const css = readFileSync(join(__dirname, "../../styles/arc.css"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    const roles = ["option", "menuitem", "menuitemradio", "menuitemcheckbox"];
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
      selector: selector.replace(/\s+/g, " ").trim(),
      body,
    }));
    const forRoles = (rule: { selector: string }) =>
      roles.every((role) => rule.selector.includes(`[role="${role}"]`));
    const reset = rules.find(
      (rule) =>
        forRoles(rule) && !rule.selector.includes(":focus-visible") && /border: 0/.test(rule.body),
    );
    expect(reset).toBeDefined();
    // Zero specificity and no !important: a component's own ring, border or shadow on a role row wins.
    expect(reset!.selector.startsWith(":where(:root) :where(")).toBe(true);
    expect(reset!.body).toContain("border: 0;");
    expect(reset!.body).toContain("box-shadow: none;");
    // The global reset must never again hold a role row's border, outline or shadow with !important.
    for (const rule of rules.filter(forRoles)) {
      expect(rule.body).not.toMatch(/(?:border|outline|box-shadow)[\w-]*\s*:[^;]*!important/);
    }
    // Keyboard focus keeps the hover fill and gains the shared focus line (transparent under pointer input).
    const focus = rules.find(
      (rule) =>
        forRoles(rule) &&
        rule.selector.includes(":focus-visible") &&
        /--ui-surface-hover/.test(rule.body),
    );
    expect(focus).toBeDefined();
    expect(focus!.selector.startsWith(":where(:root) :where(")).toBe(true);
    expect(focus!.body).toContain("box-shadow: var(--ui-focus-ring);");
    // The shared row skin owns its fill-only focus, so the fallback line never frames a ListRow.
    const row = readFileSync(join(__dirname, "ListRow.module.css"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    expect(row).toMatch(/\.row\s*\{[^}]*box-shadow: none;/);
    const arc = css;
    expect(arc).toContain("outline: var(--ui-focus-width) solid var(--ui-focus-ring-color)");
    const picker = readFileSync(join(__dirname, "picker/picker.module.css"), "utf8");
    expect(picker).toMatch(/\.list\.list:focus-visible\s*\{\s*box-shadow: inset/);
  });
});

const read = (file: string) =>
  readFileSync(join(__dirname, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

it("shares the root spacing and radius scale with Arc surfaces", () => {
  const root = read("../../styles/index.css");
  const arc = read("../../styles/arc.css");
  const arcRoot = [...arc.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector]) => selector.trim() === ".bycoda-arc")
    .map(([, , body]) => body)
    .join("\n");
  expect(arcRoot).toContain("--control-height-lg:");
  const names = [
    ...[1, 2, 3, 4, 5, 6, 8, 10, 12, 16].map((step) => `space-${step}`),
    ...["control", "panel", "surface", "pill"].map((role) => `radius-${role}`),
  ];
  for (const name of names) {
    const declaration = new RegExp(`--${name}\\s*:`, "g");
    expect(root.match(declaration), name).toHaveLength(1);
    expect(arcRoot, name).not.toMatch(declaration);
  }
});

const rule = (css: string, selector: string) => {
  const start = css.search(new RegExp(String.raw`(^|\})\s*\.${selector.slice(1)}\s*\{`));
  if (start < 0) return "";
  const open = css.indexOf("{", start);
  return css.slice(open + 1, css.indexOf("}", open));
};

describe("popup rows preserve natural width within the viewport", () => {
  it.each([
    ["arc/combobox/combobox.module.css", ".choiceLabel"],
    ["arc/expanding-search/expanding-search.module.css", ".optionTitle"],
  ])("%s %s keeps primary copy on one line", (file, selector) => {
    expect(rule(read(file), selector)).toContain("white-space: nowrap;");
  });

  it("lets menu action labels wrap when their popup reaches the viewport cap", () => {
    const copy = rule(read("arc/context-menu/context-menu.module.css"), ".copy");
    expect(copy).toContain("white-space: normal;");
    expect(copy).toContain("overflow-wrap: anywhere;");
  });

  it("caps the shared list popup at 800px", () => {
    expect(readFileSync(join(__dirname, "../lib/popover.ts"), "utf8")).toContain(
      "export const POPUP_MAX_WIDTH = 800;",
    );
    expect(read("Popover.tsx")).toContain(
      "popupListWidth(Math.max(naturalWidth, listWidth.current), minWidth)",
    );
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
