import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const css = ["src/styles/index.css", "src/features/files/editor/editorBlame.css"]
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

it("raises stroke and secondary-text roles under OS increased contrast", () => {
  const block = css.match(/@media \(prefers-contrast: more\)\s*\{\s*:root\s*\{([^}]*)\}/)?.[1];
  expect(block).toBeDefined();
  expect(block).toMatch(/--ui-stroke-boost:\s*1\.5;/);
  expect(block).toMatch(/--ui-secondary-boost:\s*1\.15;/);
});

it("routes stroke and secondary roles through the boosts", () => {
  expect(css).toMatch(/--color-stroke:[\s\S]*?var\(--ui-stroke-boost, 1\)/);
  expect(css).toMatch(/--ui-pane-border:[\s\S]*?var\(--ui-stroke-boost, 1\)/);
  expect(css).toMatch(/--ui-text-secondary:[\s\S]*?var\(--ui-secondary-boost, 1\)/);
});

it("keeps readable chat and editor text on the semantic text tokens, not content alpha", () => {
  const selectors = [
    '.agent-markdown [data-streamdown="code-block-body"] code > span::before',
    ".agent-markdown .markdown-code-copy",
    ".agent-reasoning.agent-markdown p,\n.agent-reasoning.agent-markdown li",
    ".inbox-comment-md.agent-markdown blockquote",
    '.whats-new-md.agent-markdown [data-streamdown="heading-3"]',
    ".cm-blameCardSha",
    ".cm-blameCardDate",
  ];
  for (const selector of selectors) {
    const start = css.indexOf(`\n${selector} {`);
    expect(start, selector).toBeGreaterThanOrEqual(0);
    const body = css.slice(start, css.indexOf("}", start));
    expect(body, selector).toMatch(/(?:^|\n)\s*color: var\(--ui-text-(?:secondary|muted)\);/);
  }
  expect(css).toMatch(
    /\.agent-reasoning\.agent-markdown \{\s*--md-emphasis-color: var\(--ui-text-secondary\);/,
  );
});
