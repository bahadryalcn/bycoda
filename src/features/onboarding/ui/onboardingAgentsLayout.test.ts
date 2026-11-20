import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/features/onboarding/ui/onboarding.css", "utf8");

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  expect(match, `missing rule ${selector}`).not.toBeNull();
  return match![1];
}

describe("onboarding agent rows layout", () => {
  it("lets the status line wrap instead of forcing nowrap", () => {
    expect(rule(".onboarding-body .onboarding-agent-status")).not.toMatch(/white-space:\s*nowrap/);
  });

  it("sizes the control cluster to its content instead of fixed tracks", () => {
    const controls = rule(".onboarding-agent-controls");
    expect(controls).not.toMatch(/grid-template-columns/);
    expect(controls).toMatch(/flex-wrap:\s*wrap/);
    expect(css).not.toMatch(/8\.5rem\s+5\.5rem/);
  });

  it("reflows rows by the onboarding pane width, not the window width", () => {
    expect(rule(".onboarding-agent")).toMatch(/flex-wrap:\s*wrap/);
    expect(css).not.toMatch(/@media[^{]*\{\s*\.onboarding-agent\b/);
  });
});
