import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const composer = readFileSync(new URL("./Composer.tsx", import.meta.url), "utf8");

it("uses the visible Cancel edit label and surfaces only its Escape shortcut", () => {
  const label = composer.indexOf('<span>{t("Cancel edit")}</span>');
  expect(label).toBeGreaterThan(-1);
  const opening = composer.slice(composer.lastIndexOf("<Button", label), label);
  expect(opening).toContain('shortcut="Esc"');
  expect(opening).not.toMatch(/\b(?:aria-label|label|tooltip|title)=/);
});

it("allows the capped draft to show a scrollbar while keeping its mirror aligned", () => {
  const css = readFileSync(new URL("../../../styles/index.css", import.meta.url), "utf8");
  const fieldClasses = composer.match(/className=\{\x60(composer-field[^${]+)/)?.[1];
  expect(fieldClasses).toContain("max-h-(--composer-draft-max-height)");
  expect(fieldClasses).not.toContain("scrollbar-none");
  expect(css).toMatch(/\.composer-field,\s*\.composer-highlight\s*\{\s*scrollbar-gutter: stable;/);
});
