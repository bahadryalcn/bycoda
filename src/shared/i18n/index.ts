import { useSyncExternalStore } from "react";
import english from "./locales/en.json";

import { isLocale, resolveLocale, type Locale, type LanguagePreference } from "./languages";
export { LANGUAGES, isLocale, resolveLocale } from "./languages";
export type { Locale, LanguagePreference } from "./languages";
export const LANGUAGE_STORAGE_KEY = "bycoda.language";
export type LanguageDomain = "git" | "technical";
export type DomainLanguagePreference = Locale | "app";
export const DOMAIN_LANGUAGE_STORAGE_KEYS = {
  git: "bycoda.language.git",
  technical: "bycoda.language.technical",
} as const;
function readDomainPreference(domain: LanguageDomain): DomainLanguagePreference {
  try {
    const stored = localStorage.getItem(DOMAIN_LANGUAGE_STORAGE_KEYS[domain]);
    return stored === "app" || isLocale(stored) ? stored : "en";
  } catch {
    return "en";
  }
}
const domainPreferences = {
  git: readDomainPreference("git"),
  technical: readDomainPreference("technical"),
};
const domainRequests = { git: 0, technical: 0 };
type Catalog = Record<string, string>;
const loaders: Record<Exclude<Locale, "en">, () => Promise<{ default: Catalog }>> = {
  tr: async () => ({
    default: JSON.parse((await import("./locales/tr.json?raw")).default) as Catalog,
  }),
  de: async () => ({
    default: JSON.parse((await import("./locales/de.json?raw")).default) as Catalog,
  }),
  fr: async () => ({
    default: JSON.parse((await import("./locales/fr.json?raw")).default) as Catalog,
  }),
  es: async () => ({
    default: JSON.parse((await import("./locales/es.json?raw")).default) as Catalog,
  }),
  pt: async () => ({
    default: JSON.parse((await import("./locales/pt.json?raw")).default) as Catalog,
  }),
  "zh-CN": async () => ({
    default: JSON.parse((await import("./locales/zh-CN.json?raw")).default) as Catalog,
  }),
  ja: async () => ({
    default: JSON.parse((await import("./locales/ja.json?raw")).default) as Catalog,
  }),
};
const catalogs = new Map<Locale, Catalog>([["en", english]]);
const loads = new Map<Locale, Promise<Catalog>>();
const listeners = new Set<() => void>();
let revision = 0;
let request = 0;

function systemLocale(): Locale {
  return resolveLocale(
    typeof window === "undefined" || typeof navigator === "undefined"
      ? []
      : navigator.languages?.length
        ? navigator.languages
        : [navigator.language],
  );
}
function readPreference(): LanguagePreference {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLocale(stored) ? stored : "system";
  } catch {
    return "system";
  }
}
let preference = readPreference();
let locale: Locale = preference === "system" ? systemLocale() : preference;

async function loadCatalog(next: Locale): Promise<Catalog> {
  const cached = catalogs.get(next);
  if (cached) return cached;
  let pending = loads.get(next);
  if (!pending && next !== "en") {
    pending = loaders[next]()
      .then((module) => {
        catalogs.set(next, module.default);
        return module.default;
      })
      .finally(() => loads.delete(next));
    loads.set(next, pending);
  }
  return pending ?? english;
}
/** App locale last sent to the native menu from this window. */
let nativeLabelsLocale: Locale | undefined;
function notify() {
  revision++;
  searchLocale = undefined;
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
    document.documentElement.dir = "ltr";
  }
  for (const listener of listeners) listener();
  if (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window &&
    nativeLabelsLocale !== locale
  ) {
    const sentLocale = locale;
    nativeLabelsLocale = sentLocale;
    const labels = Object.fromEntries(Object.keys(english).map((key) => [key, t(key)]));
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("native_language_set", { labels }))
      .catch((error) => {
        if (nativeLabelsLocale === sentLocale) nativeLabelsLocale = undefined;
        console.warn("Could not update native menu language", error);
      });
  }
}
async function applyPreference(next: LanguagePreference, persist: boolean) {
  const id = ++request;
  const nextLocale = next === "system" ? systemLocale() : next;
  await loadCatalog(nextLocale);
  if (id !== request) return;
  preference = next;
  locale = nextLocale;
  if (persist) {
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      /* Session-only when storage is unavailable. */
    }
  }
  notify();
}
export function setLanguagePreference(next: LanguagePreference): Promise<void> {
  if (next !== "system" && !isLocale(next))
    return Promise.reject(new Error("Unsupported language"));
  return applyPreference(next, true);
}
export const getLanguagePreference = () => preference;
export const getDomainLanguagePreference = (domain: LanguageDomain) => domainPreferences[domain];
export const getLocale = (domain?: LanguageDomain): Locale => {
  const selected = domain ? domainPreferences[domain] : "app";
  return selected === "app" ? locale : selected;
};
async function applyDomainPreference(
  domain: LanguageDomain,
  next: DomainLanguagePreference,
  persist: boolean,
) {
  const id = ++domainRequests[domain];
  if (next !== "app") await loadCatalog(next);
  if (id !== domainRequests[domain]) return;
  domainPreferences[domain] = next;
  if (persist) {
    try {
      localStorage.setItem(DOMAIN_LANGUAGE_STORAGE_KEYS[domain], next);
    } catch {
      /* Session-only. */
    }
  }
  notify();
}
export function setDomainLanguagePreference(
  domain: LanguageDomain,
  next: DomainLanguagePreference,
): Promise<void> {
  if (next !== "app" && !isLocale(next)) return Promise.reject(new Error("Unsupported language"));
  return applyDomainPreference(domain, next, true);
}
export function subscribeLocale(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
/** React subscriptions update labels without remounting sessions or inputs. */
export function useLocale(domain?: LanguageDomain): Locale {
  useSyncExternalStore(
    subscribeLocale,
    () => revision,
    () => 0,
  );
  return getLocale(domain);
}

/** Only application-owned copy may be passed here; never provider/user content. */
export function t(message: string, values?: Record<string, unknown>): string {
  return translateAt(locale, message, values);
}
export function translateAt(
  selected: Locale,
  message: string,
  values?: Record<string, unknown>,
): string {
  const translated = catalogs.get(selected)?.[message] ?? message;
  // Replace slots in one pass so a value containing {p1} cannot inject a slot.
  return values
    ? translated.replace(/\{(p\d+)\}/g, (match, key: string) =>
        Object.prototype.hasOwnProperty.call(values, key) ? String(values[key] ?? "") : match,
      )
    : translated;
}
export function formatNumber(value: number, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(locale, options).format(value);
}
export function formatDate(value: Date | number, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(locale, options).format(value);
}

let searchLocale: Locale | undefined;
let sourceLookup = new Map<string, string[]>();
/** Keep English search terms available alongside translated settings labels. */
export function sourceMessages(translated: string): readonly string[] {
  if (searchLocale !== locale) {
    sourceLookup = new Map();
    for (const message of Object.keys(english)) {
      const value = t(message);
      const matches = sourceLookup.get(value) ?? [];
      matches.push(message);
      sourceLookup.set(value, matches);
    }
    searchLocale = locale;
  }
  return sourceLookup.get(translated) ?? [];
}

export const languageReady = Promise.all([
  applyPreference(preference, false).catch(() => {
    locale = "en";
    notify();
  }),
  ...(["git", "technical"] as const).map((domain) =>
    applyDomainPreference(domain, domainPreferences[domain], false).catch(() =>
      applyDomainPreference(domain, "en", false),
    ),
  ),
]);
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    for (const domain of ["git", "technical"] as const) {
      if (event.key === DOMAIN_LANGUAGE_STORAGE_KEYS[domain] || event.key === null) {
        void applyDomainPreference(domain, readDomainPreference(domain), false).catch(
          () => undefined,
        );
      }
    }
    if (event.key === LANGUAGE_STORAGE_KEY || event.key === null) {
      void applyPreference(readPreference(), false).catch(() => undefined);
    }
  });
  window.addEventListener("languagechange", () => {
    if (preference === "system") void applyPreference("system", false).catch(() => undefined);
  });
}
