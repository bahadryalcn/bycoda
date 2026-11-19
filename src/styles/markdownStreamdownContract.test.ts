import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Contract between the global stylesheet and streamdown's rendered output.
// streamdown is declared with a caret range, so a minor update may rename the
// `data-streamdown` values the CSS selects. This test fails on that drift.
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const css = readFileSync(resolve(here, "index.css"), "utf8");
const streamdownDist = resolve(root, "node_modules/streamdown/dist");

function streamdownValues(): Set<string> {
  const values = new Set<string>();
  for (const file of readdirSync(streamdownDist)) {
    if (!file.endsWith(".js")) continue;
    const source = readFileSync(resolve(streamdownDist, file), "utf8");
    for (const match of source.matchAll(/streamdown"?\s*[:=]\s*"([a-z0-9-]+)"/g)) {
      values.add(match[1]!);
    }
  }
  return values;
}

describe("markdown stylesheet streamdown contract", () => {
  it("only selects data-streamdown values streamdown renders", () => {
    const cssValues = new Set(
      [...css.matchAll(/data-streamdown="([a-z0-9-]+)"/g)].map((match) => match[1]!),
    );
    const rendered = streamdownValues();
    expect(cssValues.size).toBeGreaterThan(0);
    const missing = [...cssValues].filter((value) => !rendered.has(value));
    expect(missing).toEqual([]);
  });

  it("drives emphasis colour from one custom property without !important", () => {
    const emphasisRules = css.match(/\.agent-markdown (?:p|li) (?:strong|em)[^{]*\{[^}]*\}/g) ?? [];
    expect(emphasisRules.length).toBeGreaterThan(0);
    for (const rule of emphasisRules) {
      expect(rule).toContain("var(--md-emphasis-color)");
      expect(rule).not.toContain("!important");
    }
    expect(css).not.toMatch(/--md-emphasis-color[^;]*!important/);
  });
});
