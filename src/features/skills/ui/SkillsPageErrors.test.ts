import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "../../../shared/i18n/locales/en.json";

// Regression for #689: Skills failure copy must go through t() with a locale key,
// and error detail must not be stringified with a visible "Error: " prefix.
const source = readFileSync(new URL("./SkillsPage.tsx", import.meta.url), "utf8");

describe("SkillsPage error copy", () => {
  it("has no hard-coded English failure template literals", () => {
    expect(source).not.toMatch(/`Could not /);
  });

  it("does not stringify raw errors into visible text", () => {
    expect(source).not.toMatch(/String\(err(or)?\)/);
  });

  // Regression for #582: a preview failure keeps its translated headline, and its raw cause goes
  // behind Details; no English literal reaches a thrown error or a machine name.
  it("has no untranslated preview failure or fallback literals", () => {
    expect(source).not.toMatch(/Error\("SKILL\.md is missing/);
    expect(source).not.toMatch(/\?\? "Other machine"/);
    expect(source).toContain('t("Could not read SKILL.md.")');
    expect(source).toContain("details={previewError.details");
  });

  it("localizes each named Skills failure key in English", () => {
    for (const key of [
      "Could not read SKILL.md.",
      "SKILL.md is missing.",
      "Other machine",
      "Could not save the skill preference. {p0}",
      "Could not open the folder: {p0}",
      "Could not delete {p0}. {p1}",
    ]) {
      expect(en).toHaveProperty([key]);
      expect(source).toContain(`t("${key}"`);
    }
  });
});
