import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Source regression for issue #1000: crew label width was `spacing - 8`, so a dense crew drove the
 * width to zero or below and the name collapsed to an ellipsis. The width now has a readable floor,
 * names wrap inside their column instead of clipping, and the full name stays in the DOM.
 */

// happy-dom rewrites import.meta.url, so resolve from the vitest root instead.
const UI_DIR = resolve(process.cwd(), "src/features/sessions/ui");

type Rule = { selectors: string[]; body: string };

function cssRules(file: string): Rule[] {
  const css = readFileSync(resolve(UI_DIR, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: match[1].split(",").map((part) => part.trim()),
    body: match[2],
  }));
}

function ruleFor(file: string, selector: string): Rule | undefined {
  return cssRules(file).find((rule) => rule.selectors.includes(selector));
}

describe("crew scene label layout", () => {
  const scene = readFileSync(resolve(UI_DIR, "CrewScene.tsx"), "utf8");

  it("floors the label width so dense crews never produce a zero or negative box", () => {
    expect(scene).toMatch(/const MIN_LABEL_WIDTH = \d+;/);
    expect(scene).toMatch(/Math\.max\(spacing - 8, MIN_LABEL_WIDTH\)/);
    expect(scene).not.toMatch(/Math\.min\(spacing - 8,/);
  });

  it("lets long names wrap in their column instead of clipping them to an ellipsis", () => {
    const label = ruleFor("CrewScene.css", ".crew-scene__label");
    expect(label?.body).toMatch(/white-space:\s*normal/);
    expect(label?.body).toMatch(/overflow-wrap:\s*anywhere/);
    expect(label?.body).not.toMatch(/nowrap|text-overflow/);
  });

  it("keeps the name clamped to two lines so a wrapped label cannot grow over the whole scene", () => {
    const name = ruleFor("CrewScene.css", ".crew-scene__name");
    expect(name?.body).toMatch(/-webkit-line-clamp:\s*2/);
    expect(name?.body).toMatch(/overflow:\s*hidden/);
  });

  it("renders the full display name, never a pre-truncated or sliced string", () => {
    expect(scene).toMatch(/<span className="crew-scene__name">\{displayName\}<\/span>/);
    expect(scene).not.toMatch(/displayName\.(slice|substring)\(/);
  });

  it("keeps the labels layer non-interactive so navigation under the scene is unchanged", () => {
    const layer = ruleFor("CrewScene.css", ".crew-scene__labels");
    expect(layer?.body).toMatch(/pointer-events:\s*none/);
    expect(scene).toMatch(/className="crew-scene__labels" aria-hidden="true"/);
  });
});
