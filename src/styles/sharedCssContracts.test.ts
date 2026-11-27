import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

/**
 * Regressions for #1351 (drag badge subject must truncate, not wrap), #1353 (SubTabs and EffortScale
 * keep their selected/filled cues in forced-colors) and #1358 (settings CSS never styles through the
 * navigation-owned #setting-* / #appearance-topic-* ids).
 */
const read = (path: string) => readFileSync(path, "utf8");

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

it("truncates the drag badge subject on one line", () => {
  const css = read("src/styles/index.css");
  const rule = /\.pointer-drop-hint-subject\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  expect(rule).toContain("text-overflow: ellipsis");
  expect(rule).toContain("white-space: nowrap");
  expect(css.match(/^\.pointer-drop-hint \{/gm)).toHaveLength(1);
});

it("keeps the selected sub-tab and effort bars visible in forced-colors", () => {
  const subTabs = read("src/shared/ui/SubTabs.module.css");
  expect(subTabs).toMatch(
    /@media \(forced-colors: active\)[\s\S]*aria-selected="true"[\s\S]*Highlight/,
  );
  const effort = read("src/shared/ui/EffortScale.module.css");
  expect(effort).toMatch(/@media \(forced-colors: active\)[\s\S]*\.fill[\s\S]*CanvasText/);
});

it("does not select settings rows through ids", () => {
  for (const file of cssFiles("src/features/settings")) {
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css, file).not.toMatch(/#(setting|appearance-topic)-[\w-]+/);
  }
});
