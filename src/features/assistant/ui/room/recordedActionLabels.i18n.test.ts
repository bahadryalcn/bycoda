import { describe, expect, it } from "vitest";
import de from "../../../../shared/i18n/locales/de.json";
import en from "../../../../shared/i18n/locales/en.json";
import es from "../../../../shared/i18n/locales/es.json";
import fr from "../../../../shared/i18n/locales/fr.json";
import ja from "../../../../shared/i18n/locales/ja.json";
import pt from "../../../../shared/i18n/locales/pt.json";
import tr from "../../../../shared/i18n/locales/tr.json";
import zhCN from "../../../../shared/i18n/locales/zh-CN.json";
import { LANGUAGES, type Locale } from "../../../../shared/i18n/languages";
import { RECORDED_ACTION_IDS, recordedActionLabel } from "./recordedActionLabels";

// Typed per locale, so adding a supported language without a catalog fails to compile.
const catalogs: Record<Locale, Record<string, string>> = {
  tr,
  en,
  de,
  fr,
  es,
  pt,
  "zh-CN": zhCN,
  ja,
};

// English is the source locale, so each label is also its own catalog key.
const labels = [...RECORDED_ACTION_IDS.map(recordedActionLabel), recordedActionLabel("unknown.id")];

describe("recorded action labels locale parity", () => {
  it("translates every recorded action label in every supported locale", () => {
    const missing: string[] = [];
    for (const { value: locale } of LANGUAGES)
      for (const label of labels)
        if (!catalogs[locale][label]?.trim()) missing.push(`${locale}: ${label}`);
    expect(missing).toEqual([]);
  });

  it("keeps the English source catalog equal to the source copy", () => {
    for (const label of labels) expect(en[label as keyof typeof en]).toBe(label);
  });
});
