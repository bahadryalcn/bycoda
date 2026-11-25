import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Source regression for issue #1012: idle crew labels were drawn at 45% opacity, which faded
 * their names and context percentages below the 4.5:1 text minimum in the hero scene.
 * The decorative conversation backdrop dims its artwork and label layer together.
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

function rulesFor(file: string, selector: string): Rule[] {
  return cssRules(file).filter((rule) => rule.selectors.includes(selector));
}

describe("crew scene label legibility", () => {
  it("never dims label or detail text with opacity, in any theme", () => {
    const offenders = [...cssRules("CrewScene.css"), ...cssRules("crewClassicColor.css")]
      .filter((rule) => rule.selectors.some((s) => /crew-scene__(label|detail)\b/.test(s)))
      .filter((rule) => /(^|[;\s{])opacity\s*:/.test(rule.body))
      .map((rule) => rule.selectors.join(", "));
    expect(offenders).toEqual([]);
  });

  it("draws idle captions in the semantic secondary text colour", () => {
    const [base] = rulesFor("CrewScene.css", ".crew-scene__label");
    expect(base?.body).toMatch(/color:\s*var\(--ui-text-secondary\)/);
  });

  it("keeps working labels distinct from idle ones by colour and weight", () => {
    const [working] = rulesFor("CrewScene.css", '.crew-scene__label[data-working="true"]');
    expect(working?.body).toMatch(/color:\s*currentColor/);
    expect(working?.body).toMatch(/font-weight:\s*500/);
    const [base] = rulesFor("CrewScene.css", ".crew-scene__label");
    expect(base?.body).not.toMatch(/font-weight/);
  });

  it("dims the backdrop labels to the same opacity as the artwork", () => {
    for (const selector of ["canvas", ".crew-scene__labels"]) {
      const [layer] = rulesFor("CrewScene.css", `.crew-scene--background ${selector}`);
      expect(layer?.body ?? "", selector).toMatch(/opacity:\s*0\.28/);
    }
  });

  it("applies one idle caption colour to every theme, with no light-only override", () => {
    expect(readFileSync(resolve(UI_DIR, "crewClassicColor.css"), "utf8")).not.toMatch(
      /theme-light/,
    );
  });
});
