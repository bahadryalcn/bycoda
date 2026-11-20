import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import de from "../../../shared/i18n/locales/de.json";
import en from "../../../shared/i18n/locales/en.json";
import es from "../../../shared/i18n/locales/es.json";
import fr from "../../../shared/i18n/locales/fr.json";
import ja from "../../../shared/i18n/locales/ja.json";
import pt from "../../../shared/i18n/locales/pt.json";
import tr from "../../../shared/i18n/locales/tr.json";
import zhCN from "../../../shared/i18n/locales/zh-CN.json";

// Regression for #276: the Inbox/discussion empty-state prompt must go through t() with a
// locale key in every locale, not render as a bare English literal.
const source = readFileSync(new URL("./SessionPane.tsx", import.meta.url), "utf8");
const key = "Explore this item with your agent.";

describe("SessionPane inbox discussion empty state", () => {
  it("routes the inbox-ask prompt through t() instead of a bare literal", () => {
    expect(source).toContain(`: t("${key}")`);
    expect(source).not.toContain(`: "${key}"`);
  });

  it("has a translated value for the prompt in every locale", () => {
    const locales = { en, de, es, fr, ja, pt, tr, "zh-CN": zhCN };
    for (const [name, messages] of Object.entries(locales)) {
      expect(messages, name).toHaveProperty([key]);
      expect((messages as Record<string, string>)[key], name).not.toBe("");
    }
  });
});
