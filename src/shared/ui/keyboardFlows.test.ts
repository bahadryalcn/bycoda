import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const root = join(process.cwd(), "src");
const read = (path: string) => readFileSync(join(root, path), "utf8");

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return cssFiles(full);
    return name.endsWith(".css") ? [full] : [];
  });
}

/** Files whose `outline: none` is safe: a bordered ancestor owns the cue, or nothing focusable is styled. */
const OUTLINE_NONE_OWNED_ELSEWHERE = new Set([
  "PopoverSearchHeader.module.css", // data-ui-focus-group frame draws the cue
  "PromptField.module.css", // the frame owns the single focus ring
  "arc/activity-heatmap/activity-heatmap.module.css", // outline on the non-focusable grid; cells use the base cue
  "arc/context-menu/context-menu.module.css", // the target wrapper is not focusable
]);

it("every shared stylesheet that removes an outline also draws a keyboard focus cue", () => {
  const base = join(root, "shared", "ui");
  const missing = cssFiles(base)
    .map((file) => file.slice(base.length + 1).replaceAll("\\", "/"))
    .filter((file) => {
      const css = readFileSync(join(base, file), "utf8");
      if (!/outline:\s*(none|0)\b/.test(css)) return false;
      if (OUTLINE_NONE_OWNED_ELSEWHERE.has(file)) return false;
      return !/:focus-visible|:focus-within|:focus\b/.test(css);
    });
  // An unlayered `outline: none` beats the layered base cue, so the module must draw its own.
  expect(missing).toEqual([]);
});

it("chart scrubbers show the keyboard cue from the focus tokens", () => {
  for (const [file, cls] of [
    ["shared/ui/arc/bar-chart/bar-chart.module.css", "scrubber"],
    ["shared/ui/arc/line-chart/line-chart.module.css", "plot"],
  ] as const) {
    const css = read(file);
    const rule = new RegExp(String.raw`\.${cls}:focus-visible\s*\{([^}]*)\}`).exec(css);
    expect(rule?.[1], file).toContain("var(--ui-focus-ring-color)");
  }
});

it("shortcut hints for rebindable commands read the keybinding registry, not a literal", () => {
  const readsRegistry: Array<[string, string, RegExp]> = [
    [
      "features/sessions/ui/SessionsNoMatch.tsx",
      'useKeybindingShortcut("App: Search")',
      /"mod\+k"/i,
    ],
    [
      "features/files/ui/EditorContextMenu.tsx",
      'useKeybindingShortcut("Editor: Find")',
      /"Find"\), false, "Mod\+F"/,
    ],
    [
      "features/notes/ui/NoteMarkdownEditor.tsx",
      'useKeybindingShortcut("Editor: Replace")',
      /"Mod\+F \/ Mod\+H"/,
    ],
  ];
  for (const [file, hook, literal] of readsRegistry) {
    const source = read(file);
    expect(source, file).toContain(hook);
    expect(source, file).not.toMatch(literal);
  }
});
