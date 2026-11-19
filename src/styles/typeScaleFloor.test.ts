import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Regression for #330: the chat markdown plan-step dot (8.5px) and code-block line numbers (10px)
// were literal sizes below the shared type scale floor (`--ui-font-micro`, 11px) and bypassed the
// font tokens, so they could not be retuned centrally. Both now read the micro token, and no
// global stylesheet declares a literal `font-size` under that floor.
const here = dirname(fileURLToPath(import.meta.url));
const stylesheets = ["index.css", "bycoda.css", "../features/sessions/ui/PlanStepsBurst.css"].map(
  (file) => readFileSync(resolve(here, file), "utf8"),
);
const css = stylesheets.join("\n");

function declarations(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...css.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, "g"))].map(
    (match) => match[1]!,
  );
}

describe("chat markdown type scale floor", () => {
  it("sets the plan step dot and code line numbers from the micro token", () => {
    for (const selector of [
      ".plan-step-dot",
      '.agent-markdown [data-streamdown="code-block-body"] code > span::before',
    ]) {
      const blocks = declarations(selector);
      expect(blocks.length, selector).toBe(1);
      expect(blocks[0]).toContain("font-size: var(--ui-font-micro);");
    }
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
