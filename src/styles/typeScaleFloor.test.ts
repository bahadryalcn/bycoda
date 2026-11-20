import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Regression for #330: plan step and code line numbers use the shared micro scale.
const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(resolve(here, file), "utf8");
const stylesheets = ["index.css", "bycoda.css", "../features/sessions/ui/PlanStepsBurst.css"].map(
  read,
);
const css = stylesheets.join("\n");

function declarations(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...css.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, "g"))].map(
    (match) => match[1]!,
  );
}

describe("chat markdown type scale floor", () => {
  it("renders plan step numbers with shared micro Text", () => {
    expect(read("../features/sessions/ui/PlanStepsBurst.tsx")).toMatch(
      /<Text\b(?=[^>]*\bclassName="plan-step-number")(?=[^>]*\bsize="micro")[^>]*>/,
    );
  });

  it("sets code line numbers from the micro token", () => {
    const blocks = declarations(
      '.agent-markdown [data-streamdown="code-block-body"] code > span::before',
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain("font-size: var(--ui-font-micro);");
  });

  it("keeps literal font sizes at or above the micro token", () => {
    const floorPx = 11; // --ui-font-micro: 0.6875rem
    for (const sheet of stylesheets) {
      for (const match of sheet.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) {
        expect(Number(match[1]), match[0]).toBeGreaterThanOrEqual(floorPx);
      }
    }
  });
});
