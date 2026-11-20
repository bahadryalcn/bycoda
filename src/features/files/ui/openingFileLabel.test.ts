import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Regression for #928: the "Opening <file>…" loading label must be one whole
// translated message with a filename slot, never a translated fragment joined
// to the name, because word order and particles differ between languages.

const here = dirname(fileURLToPath(import.meta.url));
const localesDir = join(here, "../../../shared/i18n/locales");
const overridesFile = join(here, "../../../shared/i18n/tr-overrides.json");

const OPENING_SURFACES = [
  "BinaryFileView.tsx",
  "DocumentView.tsx",
  "FileLoadError.tsx",
  "FileEditor.tsx",
];

const LOCALES = ["de", "en", "es", "fr", "ja", "pt", "tr", "zh-CN"];

const OPENING_KEY = "Opening {p0}…";

describe("opening-file loading label", () => {
  it.each(OPENING_SURFACES)("%s builds the label from a whole message with a slot", (file) => {
    const source = readFileSync(join(here, file), "utf8");

    expect(source).not.toContain('t("Opening ")');
    expect(source).toContain(`t("${OPENING_KEY}", { p0:`);
  });

  it.each(LOCALES)("%s catalog uses the placeholder key and drops the fragment", (locale) => {
    const catalog = JSON.parse(readFileSync(join(localesDir, `${locale}.json`), "utf8")) as Record<
      string,
      string
    >;

    expect(catalog).not.toHaveProperty("Opening ");
    expect(catalog[OPENING_KEY]).toContain("{p0}");
  });

  it("tr-overrides no longer carries the fragment and keeps the placeholder key", () => {
    const overrides = JSON.parse(readFileSync(overridesFile, "utf8")) as Record<string, string>;

    expect(overrides).not.toHaveProperty("Opening ");
    expect(overrides[OPENING_KEY]).toBe("{p0} açılıyor…");
  });
});
