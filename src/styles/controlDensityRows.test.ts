import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Issue #1355: interactive rows must follow the Touch control-density tokens while
// Compact keeps its established minimum, so each rule pairs the literal with the token.
const read = (file: string) =>
  readFileSync(join(__dirname, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const rule = (css: string, selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^{}]*)\\}`, "m"))?.[1] ?? "";
};

describe("control-density rows", () => {
  it("bridges all four Arc heights to the saved density ladder", () => {
    const css = read("index.css");
    const arc = rule(read("arc.css"), ".bycoda-arc");
    const compact = [...css.matchAll(/^:root\s*\{([^{}]*)\}/gm)]
      .map(([, body]) => body)
      .find((body) => body?.includes("--ui-control-height-xs:"));
    expect(arc).toContain("--control-height-xs: var(--ui-control-height-xs);");
    expect(arc).toContain("--control-height-sm: var(--ui-control-height-sm);");
    expect(arc).toContain("--control-height-md: var(--ui-control-height-md);");
    expect(arc).toContain("--control-height-lg: var(--ui-control-height-lg);");
    expect(compact).toContain("--ui-control-height-sm: var(--ui-control-height-compact);");
    expect(compact).toContain("--ui-control-height-md: var(--ui-control-height);");

    const ladder = [
      [compact, ["1.5rem", "1.75rem", "2rem", "2.5rem"]],
      [
        rule(css, 'html[data-control-density="comfortable"]'),
        ["1.75rem", "2rem", "2.25rem", "2.75rem"],
      ],
      [rule(css, 'html[data-control-density="touch"]'), ["2.75rem", "2.75rem", "2.75rem", "3rem"]],
    ] as const;
    for (const [body, heights] of ladder) {
      for (const [step, name] of ["-xs", "-compact", "", "-lg"].entries()) {
        expect(body).toContain(`--ui-control-height${name}: ${heights[step]};`);
      }
    }
  });

  it("lets the workspace tab strip grow instead of pinning 32px", () => {
    const body = rule(read("bycoda.css"), ".bycoda-workspace-tabs");
    expect(body).toContain("min-height: max(32px, var(--ui-control-height-compact));");
    expect(body).not.toMatch(/(?<!-)height:\s*\d+px/);
  });

  it("sizes the host tool help summary from the density token", () => {
    const body = rule(read("../features/host-tools/host-tools.css"), ".host-tool-help summary");
    expect(body).toContain("min-block-size: max(32px, var(--ui-control-height-compact));");
  });

  it("sizes the checkout header rows from the density token", () => {
    const css = read("../features/source-control/ui/CheckoutHeader.module.css");
    expect(rule(css, ".header")).toContain("min-block-size: var(--ui-control-height-compact);");
    expect(rule(css, ".branchHeader")).toContain(
      "min-block-size: max(36px, var(--ui-control-height-compact));",
    );
    expect(rule(css, ".sectionHeader")).toContain(
      "min-block-size: var(--ui-control-height-compact);",
    );
  });
});
