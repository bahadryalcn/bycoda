import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const UI_DIR = resolve(process.cwd(), "src/features/sessions/ui");

type Rule = { selectors: string[]; body: string };

function cssRules(file: string): Rule[] {
  const css = readFileSync(resolve(UI_DIR, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: match[1].split(",").map((part) => part.trim()),
    body: match[2],
  }));
}

const rulesFor = (file: string, selector: string) =>
  cssRules(file).filter((rule) => rule.selectors.includes(selector));

describe("crew scene label pointer ownership", () => {
  it("keeps the scene, its label layer and the backdrop click-through", () => {
    const [scene] = rulesFor("CrewScene.css", ".crew-scene");
    expect(scene?.body).toMatch(/pointer-events:\s*none/);
    const [layer] = rulesFor("CrewScene.css", ".crew-scene__labels");
    expect(layer?.body).toMatch(/pointer-events:\s*none/);
    const [backdrop] = rulesFor("BycodaSession.css", ".bycoda-session-backdrop");
    expect(backdrop?.body).toMatch(/pointer-events:\s*none/);
  });

  it("lets only clipped hero labels receive the pointer", () => {
    const enabled = cssRules("CrewScene.css").filter((rule) =>
      /pointer-events:\s*auto/.test(rule.body),
    );
    const selectors = enabled.flatMap((rule) => rule.selectors).sort();
    expect(selectors).toEqual([
      ".crew-scene--hero .crew-scene__label[data-clipped]",
      ".crew-scene__status button",
    ]);
  });

  it("keeps the composer above the labels so its edge stays clickable", () => {
    const [composer] = rulesFor("BycodaSession.css", ".bycoda-entry-composer");
    expect(composer?.body).toMatch(/position:\s*relative/);
    expect(composer?.body).toMatch(/z-index:\s*1\b/);
  });
});
