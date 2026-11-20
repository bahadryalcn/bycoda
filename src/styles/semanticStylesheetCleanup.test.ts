import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readFileSync(resolve(here, name), "utf8");

// #329: dead bycoda-* families and the unreferenced session-link stylesheet stay deleted (#328).
describe("removed dead stylesheet rules", () => {
  it("keeps the unused bycoda-* classes out of bycoda.css", () => {
    const css = read("bycoda.css");
    for (const name of [
      "bycoda-workspace-heading",
      "bycoda-heading-mark",
      "bycoda-heading-count",
      "bycoda-page-eyebrow",
      "bycoda-title-settle",
      "bycoda-workbench-tag",
    ]) {
      expect(css, name).not.toContain(name);
    }
  });

  it("has no empty media block in toolNavigation.css", () => {
    const css = readFileSync(resolve(here, "../app/shell/toolNavigation.css"), "utf8");
    expect(css).not.toMatch(/@media[^{]*\{\s*\}/);
  });

  it("does not ship the unreferenced session-link-web.css", () => {
    expect(existsSync(resolve(here, "session-link-web.css"))).toBe(false);
  });
});

// #338: the composer frame follows the popup radius token.
describe("composer surface", () => {
  it("uses the popup radius token on the composer box and docked question form", () => {
    const css = read("bycoda.css");
    const rule = css.match(
      /\bhtml\s+\[data-composer-box\]\[data-ui-focus-group\],\s*\[data-composer\]\s*>\s*\[data-question-form\]\s*>\s*form\s*\{([^}]*)\}/,
    );
    expect(rule?.[1]).toContain("border-radius: var(--ui-radius-popup);");
    expect(rule?.[1]).toContain(
      "background: var(--ui-chat-composer-surface, var(--ui-composer-surface));",
    );
    expect(rule?.[1]).not.toMatch(/border-radius:\s*\d+px/);
  });
});

// #332: interactive and body text uses the semantic text tokens, not content at low alpha.
describe("text colours", () => {
  it("has no 35-55% content-alpha text colour left in index.css", () => {
    const css = read("index.css");
    expect(css).not.toMatch(
      /(?<![-\w])color:\s*color-mix\(in srgb, var\(--color-content\) (?:3[5-9]|4\d|5[0-5])%, transparent\)/,
    );
  });
});
