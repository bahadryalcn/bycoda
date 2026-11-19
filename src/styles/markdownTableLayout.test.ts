import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("reserves space for the Markdown table copy action and wraps narrow columns", () => {
  const css = readFileSync(new URL("./index.css", import.meta.url), "utf8");
  expect(css).toMatch(/\.markdown-table-shell\s*\{[^}]*display: flex;[^}]*flex-direction: column;/);
  expect(css).toMatch(/\.markdown-table-shell > \.markdown-code-copy\s*\{[^}]*position: static;/);
  const cells = css.match(/\.agent-markdown \[data-streamdown="table-cell"\]\s*\{([^}]+)\}/)?.[1];
  expect(cells).toContain("min-inline-size: 6rem;");
  expect(cells).toContain("overflow-wrap: anywhere;");
});
