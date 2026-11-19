import { describe, expect, it } from "vitest";
import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import ja from "./locales/ja.json";
import pt from "./locales/pt.json";
import tr from "./locales/tr.json";
import zhCN from "./locales/zh-CN.json";

// Regression for #303: label/value strings use "Label: {p0}" and index labels
// use their own key, and every slot starts at {p0} in every locale.
const locales: Record<string, Record<string, string>> = {
  de,
  en,
  es,
  fr,
  ja,
  pt,
  tr,
  "zh-CN": zhCN,
};

const labelValueKeys = ["Last activity: {p0}", "Model: {p0}", "Checking Host {p0}…"];
const indexLabelKeys = ["Job {p0}", "Position {p0}"];
const retiredKeys = [
  "Last activity {p0}",
  "Request {p0}",
  "Model {p0}",
  "Model: {p1}",
  "Checking Host {p1}…",
];

describe("label/value and index placeholder strings", () => {
  it.each(Object.entries(locales))(
    "%s has the standardized keys with a {p0} slot",
    (_, catalog) => {
      for (const key of [...labelValueKeys, ...indexLabelKeys]) {
        expect(catalog[key], key).toBeTypeOf("string");
        expect(catalog[key], key).toContain("{p0}");
        expect(catalog[key], key).not.toContain("{p1}");
      }
    },
  );

  it.each(Object.entries(locales))("%s no longer has the retired variants", (_, catalog) => {
    for (const key of retiredKeys) {
      expect(Object.keys(catalog), key).not.toContain(key);
    }
  });

  it("keeps the English wording of the standardized keys", () => {
    expect(en["Last activity: {p0}"]).toBe("Last activity: {p0}");
    expect(en["Model: {p0}"]).toBe("Model: {p0}");
    expect(en["Position {p0}"]).toBe("Position {p0}");
    expect(en["Job {p0}"]).toBe("Job {p0}");
  });
});
