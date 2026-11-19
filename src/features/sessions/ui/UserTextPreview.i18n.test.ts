import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Regression for #1003: the long-text card and message failure copy must be whole translated
// sentences with named slots, never English fragments glued to translated pieces.
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const PREVIEW = read("src/features/sessions/ui/UserTextPreview.tsx");
const ACTIONS = read("src/features/sessions/ui/TranscriptMessageActions.tsx");
const LOCALES_DIR = resolve(process.cwd(), "src/shared/i18n/locales");
const CATALOGS = readdirSync(LOCALES_DIR)
  .filter((file) => file.endsWith(".json"))
  .map((file) => ({
    file,
    messages: JSON.parse(readFileSync(resolve(LOCALES_DIR, file), "utf8")) as Record<string, string>,
  }));

const NEW_KEYS = [
  "Long text",
  "JSON",
  "Show full long text",
  "Show full JSON",
  "{p0} characters",
  "Copy failed. {p0}",
  "Could not save note. {p0}",
];

describe("user long text card copy (#1003)", () => {
  it("builds the kind label and aria label from whole translated keys", () => {
    expect(PREVIEW).toContain('t("Long text")');
    expect(PREVIEW).toContain('t("Show full JSON")');
    expect(PREVIEW).toContain('t("Show full long text")');
    expect(PREVIEW).not.toContain("toLowerCase()");
    expect(PREVIEW).not.toContain('t(" characters")');
  });

  it("interpolates the character count through a named slot", () => {
    expect(PREVIEW).toContain('t("{p0} characters", { p0: part.text.length.toLocaleString(locale) })');
  });
});

describe("turn output failure copy (#1003)", () => {
  it("interpolates the reason through a single parametrized sentence", () => {
    expect(ACTIONS).toContain('t("Copy failed. {p0}", { p0: copy.error ?? "" })');
    expect(ACTIONS).toContain('t("Could not save note. {p0}", { p0: save.error ?? "" })');
    expect(ACTIONS).not.toContain('t("Copy failed. ")');
    expect(ACTIONS).not.toContain('t("Could not save note. ")');
  });
});

describe("locale catalogs carry the new sentence keys (#1003)", () => {
  it.each(CATALOGS.map((catalog) => [catalog.file, catalog] as const))(
    "%s has every key with a nonempty translation",
    (_file, catalog) => {
      for (const key of NEW_KEYS) {
        expect(catalog.messages[key], key).toEqual(expect.any(String));
        expect(catalog.messages[key].length, key).toBeGreaterThan(0);
      }
    },
  );

  it("keeps the JSON label distinct from the long text label in every language", () => {
    for (const { file, messages } of CATALOGS) {
      expect(messages["Long text"], file).not.toBe(messages["JSON"]);
    }
  });

  it("keeps the slot in every failure template", () => {
    for (const { file, messages } of CATALOGS) {
      expect(messages["Copy failed. {p0}"], file).toContain("{p0}");
      expect(messages["Could not save note. {p0}"], file).toContain("{p0}");
    }
  });
});
