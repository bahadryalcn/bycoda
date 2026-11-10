// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { loadVoiceSettings, saveVoiceSettings } from "./voiceSettings";
import {
  defaultWakePhrases,
  isSleepRequest,
  matchesSleepPhrase,
  matchesWakePhrase,
  normalizeWakeText,
  resolveWakePhrases,
} from "./voiceWakePhrase";

afterEach(() => localStorage.clear());

it.each([
  ["tr", "Hey Arif", "Görüşürüz"],
  ["en", "Hey Arif", "Goodbye"],
  ["de", "Hey Arif", "Tschüss"],
  ["fr", "Salut Arif", "Au revoir"],
  ["es", "Hola Arif", "Hasta luego"],
  ["pt", "Olá Arif", "Até logo"],
  ["ja", "ねえ Arif", "またね"],
  ["zh", "嘿 Arif", "再见"],
])("defaults for %s name the assistant", (language, wake, sleep) => {
  expect(defaultWakePhrases(language, "en", "Arif")).toEqual({ wake, sleep });
});

it("falls back to the interface language, then English, and to bycoda without a name", () => {
  expect(defaultWakePhrases("auto", "tr-TR", "")).toEqual({
    wake: "Hey bycoda",
    sleep: "Görüşürüz",
  });
  expect(defaultWakePhrases("ko", "ko", "Arif").sleep).toBe("Goodbye");
  expect(defaultWakePhrases(undefined, "zh-CN", "Arif").wake).toBe("嘿 Arif");
});

it("stores only owner-typed phrases so a language change moves the defaults", () => {
  saveVoiceSettings({ ...loadVoiceSettings(), wakeEnabled: true, sleepPhrase: "Hoşça kal" });
  const settings = loadVoiceSettings();
  expect(settings.wakePhrase).toBeUndefined();
  expect(resolveWakePhrases(settings, "en", "en", "Arif")).toEqual({
    wake: "Hey Arif",
    sleep: "Hoşça kal",
  });
  expect(resolveWakePhrases(settings, "tr", "en", "Arif").wake).toBe("Hey Arif");
  expect(resolveWakePhrases(settings, "de", "en", "Arif").wake).toBe("Hey Arif");
  expect(resolveWakePhrases({ wakePhrase: "Selam {name}" }, "fr", "en", "Arif").wake).toBe(
    "Selam Arif",
  );
});

it("parses settings compatibly and drops invalid phrase lengths", () => {
  localStorage.setItem("bycoda.voice", JSON.stringify({ enabled: true }));
  expect(loadVoiceSettings().wakeEnabled).toBeUndefined();
  localStorage.setItem(
    "bycoda.voice",
    JSON.stringify({ wakeEnabled: true, wakePhrase: "a", sleepPhrase: "x".repeat(41) }),
  );
  expect(loadVoiceSettings()).toMatchObject({ wakeEnabled: true });
  expect(loadVoiceSettings().wakePhrase).toBeUndefined();
  expect(loadVoiceSettings().sleepPhrase).toBeUndefined();
});

it("normalizes Turkish dotted and dotless i, accents and punctuation", () => {
  expect(normalizeWakeText("  İSTANBUL, ışık!  ")).toBe("istanbul isik");
  expect(normalizeWakeText("Görüşürüz.")).toBe("gorusuruz");
});

it("accepts the whole wake phrase with punctuation, case and one-edit slips", () => {
  expect(matchesWakePhrase("Hey, Bycoda!", "Hey bycoda")).toBe(true);
  expect(matchesWakePhrase("hey bycodo", "Hey bycoda")).toBe(true);
  expect(matchesWakePhrase("HEY ARİF.", "Hey Arif")).toBe(true);
  expect(matchesWakePhrase("ねえbycoda", "ねえ bycoda")).toBe(true);
});

it("rejects another name, a short-word slip, extra words and a phrase inside a sentence", () => {
  expect(matchesWakePhrase("hey alexa", "Hey bycoda")).toBe(false);
  expect(matchesWakePhrase("hay bycoda", "Hey bycoda")).toBe(false);
  expect(matchesWakePhrase("hey bycoda open the project", "Hey bycoda")).toBe(false);
  expect(matchesWakePhrase("I said hey bycoda", "Hey bycoda")).toBe(false);
  expect(matchesWakePhrase("bycoda", "Hey bycoda")).toBe(false);
  expect(matchesWakePhrase("hey bycxdq", "Hey bycoda")).toBe(false);
});

it("matches the sleep phrase as a whole utterance, optionally with the assistant name", () => {
  expect(matchesSleepPhrase("Görüşürüz.", "Görüşürüz", "Arif")).toBe(true);
  expect(matchesSleepPhrase("görüşürüz Arif", "Görüşürüz", "Arif")).toBe(true);
  expect(matchesSleepPhrase("Goodbye, bycoda", "Goodbye", "")).toBe(true);
  expect(matchesSleepPhrase("görüşürüz ama önce şunu yap", "Görüşürüz", "Arif")).toBe(false);
  expect(matchesSleepPhrase("görüşürüz Ali", "Görüşürüz", "Arif")).toBe(false);
});

it("requests sleep only while the owner enabled the phrases", () => {
  const profile = { name: "Arif", language: "tr-TR" };
  expect(isSleepRequest("görüşürüz", { wakeEnabled: true }, profile, "en")).toBe(true);
  expect(isSleepRequest("görüşürüz", {}, profile, "en")).toBe(false);
  expect(isSleepRequest("goodbye", { wakeEnabled: true }, profile, "en")).toBe(false);
  expect(
    isSleepRequest("hoşça kal", { wakeEnabled: true, sleepPhrase: "Hoşça kal" }, profile, "en"),
  ).toBe(true);
});
