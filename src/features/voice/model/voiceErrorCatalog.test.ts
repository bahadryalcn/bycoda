import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

// The engines report typed English keys (`classifyVoiceFailure` reads them); the companion
// localizes them with `t(value)`, which returns an unknown key unchanged. Every literal the
// engines emit must therefore exist, translated, in every locale catalog.
const LOCALES = ["en", "tr", "de", "fr", "es", "pt", "ja", "zh-CN"];
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const catalog = (locale: string) =>
  JSON.parse(read(`../../../shared/i18n/locales/${locale}.json`)) as Record<string, string>;

function emitted(file: string) {
  const source = read(file);
  const literal = String.raw`"((?:[^"\\\n]|\\.)+)"`;
  const calls = new RegExp(String.raw`(?:this\.fail|callbacks\.error)\(\s*${literal}`, "g");
  const fallbacks = new RegExp(String.raw`errorText\(cause\)\.trim\(\) \|\| ${literal}`, "g");
  return [...source.matchAll(calls), ...source.matchAll(fallbacks)].map(([, message]) => message);
}

it.each([["./realtimeVoice.ts"], ["./localVoice.ts"]])(
  "localizes every message %s reports in every locale",
  (file) => {
    const messages = emitted(file);
    expect(messages.length).toBeGreaterThan(5);
    const missing: string[] = [];
    for (const locale of LOCALES) {
      const entries = catalog(locale);
      for (const message of messages) {
        const text = entries[message];
        if (typeof text !== "string" || !text.trim()) missing.push(`${locale}: ${message}`);
        // English is the source text; every other locale must actually translate it.
        else if (locale !== "en" && text === message)
          missing.push(`${locale}: untranslated ${message}`);
      }
    }
    expect(missing).toEqual([]);
  },
);
