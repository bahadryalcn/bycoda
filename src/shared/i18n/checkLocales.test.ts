import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { expect, it } from "vitest";
import englishSource from "./locales/en.json";

it("rejects orphan English and Turkish editorial overrides", () => {
  const cwd = mkdtempSync(join(tmpdir(), "bycoda-locales-"));
  function write(file: string, content: string) {
    const target = join(cwd, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  try {
    const i18n = "src/shared/i18n";
    const catalog = Object.fromEntries(Object.keys(englishSource).map((key) => [key, key]));
    // The checker also extracts this fallback from the recorded action labels.
    catalog["Fixture fallback"] = "Fixture fallback";
    for (const locale of ["en", "tr", "de", "fr", "es", "pt", "zh-CN", "ja"]) {
      write(`${i18n}/locales/${locale}.json`, JSON.stringify(catalog));
    }
    write("src-tauri/src/menu.rs", "");
    write(
      "src/features/assistant/ui/room/recordedActionLabels.ts",
      'const RECORDED_ACTION_FALLBACK_LABEL = "Fixture fallback";',
    );
    write("scripts/i18n/glossary.json", '{"rules":[]}');
    write("scripts/i18n/glossary-baseline.json", '{"keys":[]}');
    write(`${i18n}/en-overrides.json`, '{"Removed English key":"Edited text"}');
    write(`${i18n}/tr-overrides.json`, '{"Removed Turkish key":"Edited text"}');

    const result = spawnSync(process.execPath, [resolve("scripts/i18n/check-locales.mjs")], {
      cwd,
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("en: unknown editorial source Removed English key");
    expect(result.stderr).toContain("tr: unknown editorial source Removed Turkish key");
  } finally {
    rmSync(cwd, { force: true, recursive: true });
  }
});
