import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Regression for #334: layout box properties must not be transitioned frame by frame.
const motionCss = readFileSync("src/shared/ui/Motion.module.css", "utf8");
const indexCss = readFileSync("src/styles/index.css", "utf8");

function ruleBody(css: string, selector: RegExp): string {
  const match = selector.exec(css);
  expect(match, `missing rule ${selector}`).not.toBeNull();
  return match![1];
}

describe("layout transitions (#334)", () => {
  it("Motion size transitions only grid rows, not box sizes", () => {
    const body = ruleBody(motionCss, /\.motion\[data-transition="size"\]\s*\{([^}]*)\}/);
    expect(body).toContain("grid-template-rows");
    expect(body).not.toMatch(/\b(width|height|inline-size|block-size|max-height|max-block-size)\b/);
  });

  it("tab slots do not transition margin-right", () => {
    const body = ruleBody(indexCss, /\.tab-closing,\s*\.tab-opening\s*\{([^}]*)\}/);
    expect(body).toContain("transition:");
    expect(body).not.toContain("margin-right var(");
  });
});
