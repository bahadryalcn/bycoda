import { getLocale } from "../../../shared/i18n/core";
import { voiceLanguageCode } from "./voiceLanguage";
import { loadVoiceSettings } from "./voiceSettings";

/** Wake and sleep phrase defaults per language; `{name}` is the assistant's saved name. */
const DEFAULT_PHRASES: Record<string, { wake: string; sleep: string }> = {
  tr: { wake: "Hey {name}", sleep: "Görüşürüz" },
  en: { wake: "Hey {name}", sleep: "Goodbye" },
  de: { wake: "Hey {name}", sleep: "Tschüss" },
  fr: { wake: "Salut {name}", sleep: "Au revoir" },
  es: { wake: "Hola {name}", sleep: "Hasta luego" },
  pt: { wake: "Olá {name}", sleep: "Até logo" },
  ja: { wake: "ねえ {name}", sleep: "またね" },
  zh: { wake: "嘿 {name}", sleep: "再见" },
};
export const WAKE_PHRASE_LIMITS = { min: 2, max: 40 };
const FALLBACK_NAME = "bycoda";

export type WakePhrases = { wake: string; sleep: string };
type WakeSettings = { wakeEnabled?: boolean; wakePhrase?: string; sleepPhrase?: string };

/** The voice language when fixed, otherwise the interface language; unknown falls back to English. */
function phraseLanguage(voiceLanguage: string | undefined, locale: string) {
  const code = voiceLanguageCode(voiceLanguage ?? "") ?? locale.split("-")[0];
  return code in DEFAULT_PHRASES ? code : "en";
}

function withName(phrase: string, name: string) {
  return phrase.replace(/{name}/g, () => name.trim() || FALLBACK_NAME);
}

/** Defaults for a language, computed so a language change updates them until the owner types their own. */
export function defaultWakePhrases(
  voiceLanguage: string | undefined,
  locale: string,
  name: string,
): WakePhrases {
  const found = DEFAULT_PHRASES[phraseLanguage(voiceLanguage, locale)];
  return { wake: withName(found.wake, name), sleep: found.sleep };
}

/** Owner-typed phrases win; a typed `{name}` still resolves to the assistant's name. */
export function resolveWakePhrases(
  settings: WakeSettings,
  voiceLanguage: string | undefined,
  locale: string,
  name: string,
): WakePhrases {
  const defaults = defaultWakePhrases(voiceLanguage, locale, name);
  return {
    wake: settings.wakePhrase ? withName(settings.wakePhrase, name) : defaults.wake,
    sleep: settings.sleepPhrase ? withName(settings.sleepPhrase, name) : defaults.sleep,
  };
}

/** Lowercase (Turkish İ/ı folded), accent-insensitive, punctuation removed, single spaces. */
export function normalizeWakeText(text: string): string {
  return text
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function distanceAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  const first = [...a],
    second = [...b];
  let i = 0;
  while (i < first.length && i < second.length && first[i] === second[i]) i++;
  const restA = first.slice(i + 1),
    restB = second.slice(i + 1);
  const same = (x: string[], y: string[]) => x.length === y.length && x.every((c, k) => c === y[k]);
  return same(restA, restB) || same(first.slice(i), restB) || same(restA, second.slice(i));
}

const words = (text: string) => normalizeWakeText(text).split(" ").filter(Boolean);

/**
 * The whole utterance is the wake phrase. A word of four or more letters may differ by one
 * edit (recognizer slips); shorter words and the word count must match exactly.
 */
export function matchesWakePhrase(transcript: string, phrase: string): boolean {
  const heard = words(transcript),
    wanted = words(phrase);
  if (!wanted.length) return false;
  // Scripts written without spaces ("ねえbycoda") are compared as one word.
  if (heard.length !== wanted.length) return heard.join("") === wanted.join("");
  return wanted.every((word, index) =>
    [...word].length >= 4 ? distanceAtMostOne(heard[index], word) : heard[index] === word,
  );
}

/** The whole utterance is the sleep phrase, optionally followed by the assistant's name. */
export function matchesSleepPhrase(transcript: string, phrase: string, name: string): boolean {
  const heard = normalizeWakeText(transcript),
    wanted = normalizeWakeText(phrase);
  if (!wanted) return false;
  const addressed = normalizeWakeText(name || FALLBACK_NAME);
  return heard === wanted || (!!addressed && heard === `${wanted} ${addressed}`);
}

/** Whether accepted speech asks to end the conversation; only while the owner enabled the phrases. */
export function isSleepRequest(
  transcript: string,
  settings: WakeSettings,
  profile: { name: string; language: string } | undefined,
  locale: string,
): boolean {
  if (!settings.wakeEnabled || !profile) return false;
  const { sleep } = resolveWakePhrases(settings, profile.language, locale, profile.name);
  return matchesSleepPhrase(transcript, sleep, profile.name);
}

/** `isSleepRequest` with the saved settings and the interface language. */
export function voiceSleepRequested(
  transcript: string,
  profile: { name: string; language: string } | undefined,
): boolean {
  return isSleepRequest(transcript, loadVoiceSettings(), profile, getLocale());
}
