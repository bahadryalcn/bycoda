import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

// F3 style-ownership contract: a caller className may change only a control's outer
// placement (width, margins, flex/grid placement). Those root declarations live in
// `@layer components`, below Tailwind utilities; internal presentation stays unlayered.
const modules: Record<string, string[]> = {
  "arc/input/input.module.css": [".field", ".input"],
  "arc/textarea/textarea.module.css": [".field", ".control"],
  "arc/select/select.module.css": [".field", ".trigger"],
  "arc/combobox/combobox.module.css": [".field"],
  "arc/radio-group/radio-group.module.css": [".group:global(.bycoda-arc)"],
  "arc/segmented-control/segmented-control.module.css": [".root"],
  "arc/tag-input/tag-input.module.css": [".field"],
  "arc/tree-view/tree-row.module.css": [".row"],
  "arc/stepper/stepper.module.css": [".root"],
  "arc/expanding-search/expanding-search.module.css": [".root"],
  "Checkbox.module.css": [".checkbox"],
  "ButtonGroup.module.css": [".group"],
  "SplitButton.module.css": [".group"],
  "NativeSearchableSelect.module.css": [".root"],
  "MiddleTruncate.module.css": [".root"],
  "SearchInput.module.css": ['.input[data-search-appearance="field"]'],
  "ActionHost.module.css": [".host"],
};
const placement =
  /^(?:width|inline-size|min-width|min-inline-size|max-width|max-inline-size|margin(?:-[a-z-]+)?|align-self|justify-self|flex(?:-grow|-shrink|-basis)?)$/;

/** Splits a stylesheet into its `@layer components` body and the remaining unlayered text. */
function split(css: string) {
  const start = css.indexOf("@layer components {");
  if (start < 0) return { layered: "", rest: css };
  let depth = 0;
  let end = start;
  for (let index = css.indexOf("{", start); index < css.length; index++) {
    if (css[index] === "{") depth++;
    if (css[index] === "}" && --depth === 0) {
      end = index + 1;
      break;
    }
  }
  return { layered: css.slice(start, end), rest: css.slice(0, start) + css.slice(end) };
}

function rootDeclarations(css: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = new RegExp(`(?:^|\\n|,)\\s*${escaped}\\s*(?:,[^{]*)?\\{([^{}]*)\\}`, "g");
  return [...css.matchAll(rule)].flatMap((match) =>
    match[1]
      .split(";")
      .map((declaration) => declaration.split(":")[0]!.trim())
      .filter(Boolean),
  );
}

it.each(Object.entries(modules))(
  "%s keeps root placement caller-adjustable and presentation owned",
  (file, roots) => {
    const css = readFileSync(join(__dirname, file), "utf8");
    expect(
      css.startsWith("@layer properties, theme, base, components, utilities;") ||
        css.includes("\n@layer properties, theme, base, components, utilities;"),
    ).toBe(true);
    const { layered, rest } = split(css);
    for (const root of roots) {
      // Unlayered root rules carry no placement property a caller utility could not override.
      expect(rootDeclarations(rest, root).filter((name) => placement.test(name))).toEqual([]);
    }
    // The layer holds placement only; presentation is never weakened into it.
    const layeredNames = roots.flatMap((root) => rootDeclarations(layered, root));
    expect(
      layeredNames.filter(
        (name) =>
          !placement.test(name) &&
          !/^(?:position|display|align-items|gap|border-radius)$/.test(name),
      ),
    ).toEqual([]);
  },
);

it("every shared stylesheet with a components layer pins the layer order", () => {
  const walk = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(join(directory, entry.name))
        : entry.name.endsWith(".css")
          ? [join(directory, entry.name)]
          : [],
    );
  const unpinned = walk(__dirname).filter((file) => {
    const css = readFileSync(file, "utf8");
    return (
      css.includes("@layer components") &&
      !css.includes("@layer properties, theme, base, components, utilities;")
    );
  });
  expect(unpinned).toEqual([]);
});
