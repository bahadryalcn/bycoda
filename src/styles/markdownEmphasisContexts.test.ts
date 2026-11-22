import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("sets the Markdown emphasis token on the base, reasoning and zen-fold roots", () => {
  const css = readFileSync(new URL("./index.css", import.meta.url), "utf8");
  expect(css).toMatch(/\n\.agent-markdown\s*\{[^}]*--md-emphasis-color:\s*var\(--transcript-ink-emphasis\);/);
  expect(css).toMatch(
    /\n\.agent-reasoning\.agent-markdown\s*\{[^}]*--md-emphasis-color:\s*var\(--transcript-ink-body\);/,
  );
  expect(css).toMatch(
    /\n\.zen-fold-prose \.agent-markdown\s*\{[^}]*--md-emphasis-color:\s*color-mix\(in srgb, var\(--color-content\) 80%, transparent\);/,
  );
});
