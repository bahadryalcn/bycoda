import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Regression for the code-block header overlap: the path label used to take its `right` offset
// from several same-specificity rules, and a later `:has(.markdown-code-copy)` rule always won
// (the toggle and run buttons carry that class too), so the path ran under them. The offset now
// comes from one custom property that the shell sets for the buttons it actually renders.
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, "index.css"), "utf8");

function declarations(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...css.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, "g"))].map(
    (match) => match[1]!,
  );
}

describe("code block header action inset", () => {
  it("keeps header state checks out of the highlighted token subtree", () => {
    const stylesheet = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [...stylesheet.matchAll(/([^{}]+)\s*\{/g)].map((match) => match[1]!);
    const codeSelectors = selectors.filter((selector) =>
      /markdown-code-|\[data-streamdown="code-block-header"\]/.test(selector),
    );
    for (const selector of codeSelectors) {
      for (const match of selector.matchAll(/:has\(([^)]+)\)/g)) {
        expect(match[1], selector).toMatch(/^> div > \.markdown-code-(run|icon)$/);
      }
    }
  });

  it("stops the path and fallback label at the shared actions inset", () => {
    for (const selector of [
      ".agent-markdown .markdown-code-path",
      ".agent-markdown .markdown-code-fallback-label",
    ]) {
      const blocks = declarations(selector);
      expect(blocks.length, selector).toBe(1);
      expect(blocks[0]).toContain("right: var(--markdown-code-actions-end);");
    }
  });

  it("has no per-variant right offsets left to out-rank the shared inset", () => {
    const pathRules = css.match(/[^{}]*\.markdown-code-(?:path|fallback-label)\b[^{}]*\{[^}]*\}/g);
    for (const rule of pathRules ?? []) {
      if (/\bright\s*:/.test(rule)) expect(rule).toContain("var(--markdown-code-actions-end)");
    }
    expect(css).not.toMatch(/:has\(\.markdown-code-copy\)\s+\.markdown-code-path/);
  });

  it("sizes the inset for copy + toggle, then run, on fine and coarse pointers", () => {
    expect(declarations(".agent-markdown .markdown-code-shell")[0]).toContain(
      "--markdown-code-actions-end: 68px;",
    );
    expect(
      declarations(".agent-markdown .markdown-code-shell:has(> div > .markdown-code-run)")[0],
    ).toContain("--markdown-code-actions-end: 96px;");
    // The coarse-pointer block indents its rules, so match without the line-start anchor.
    expect(css).toMatch(
      /html \.agent-markdown \.markdown-code-shell \{\s*--markdown-code-actions-end: 96px;/,
    );
    expect(css).toMatch(
      /html \.agent-markdown \.markdown-code-shell:has\(> div > \.markdown-code-run\) \{\s*--markdown-code-actions-end: 140px;/,
    );
  });

  it("keeps the summary and header padding on the same inset", () => {
    expect(declarations(".agent-markdown .markdown-code-summary")[0]).toContain(
      "inset: 0 var(--markdown-code-actions-end) 0 10px;",
    );
    expect(
      declarations(
        '.agent-markdown .markdown-code-resizable [data-streamdown="code-block-header"]',
      )[0],
    ).toContain("padding-inline-end: var(--markdown-code-actions-end);");
  });
});
