import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { FILE_REF_KINDS, FILE_REF_TONE_DEFAULTS } from "../shared/lib/fileReferenceKind";

const css = readFileSync("src/styles/file-references.css", "utf8");

it("is imported by the global stylesheet", () => {
  expect(readFileSync("src/styles/index.css", "utf8")).toContain(
    '@import "./file-references.css";',
  );
});

it("derives every kind's hue from a semantic color, with no literal colors", () => {
  expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i);
  for (const kind of FILE_REF_KINDS) {
    expect(css).toContain(`--file-ref-hue-${kind}: var(--color-`);
    expect(css).toContain(`.file-ref[data-file-kind="${kind}"]`);
  }
});

it("keeps the default hue of each kind in step with the stored defaults", () => {
  const expected = (tone: string) => `var(--color-${tone === "neutral" ? "content" : tone})`;
  for (const kind of FILE_REF_KINDS)
    expect(css).toContain(`--file-ref-hue-${kind}: ${expected(FILE_REF_TONE_DEFAULTS[kind])};`);
});

it("strengthens the tint and the ink under increased contrast and flattens it for plain", () => {
  expect(css).toMatch(
    /@media \(prefers-contrast: more\)\s*\{\s*:root\s*\{[^}]*--file-ref-ink-share/,
  );
  expect(css).toMatch(/\[data-file-refs="plain"\][^{]*\{\s*--file-ref-hue: var\(--color-content\)/);
});
