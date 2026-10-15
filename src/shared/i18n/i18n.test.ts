// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatDate,
  formatNumber,
  getLanguagePreference,
  getLocale,
  LANGUAGES,
  LANGUAGE_STORAGE_KEY,
  languageReady,
  resolveLocale,
  setLanguagePreference,
  t,
  useLocale,
  getDomainLanguagePreference,
  setDomainLanguagePreference,
  DOMAIN_LANGUAGE_STORAGE_KEYS,
} from "./index";
import { t as gitText, useLocale as useGitLocale } from "./git";
import { t as technicalText } from "./technical";
import { searchSettings, settingsSectionLabel } from "../../features/settings/model/settings";
import { LanguageSettings } from "../../features/settings/ui/LanguageSettings";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(async () => {
  await setLanguagePreference("en");
  await setDomainLanguagePreference("git", "en");
  await setDomainLanguagePreference("technical", "en");
  localStorage.clear();
});
describe("application language", () => {
  it("names task conversation links and local host activity in Turkish", async () => {
    await setLanguagePreference("tr");
    expect(t("Open worker session")).toBe("Çalışan oturumunu aç");
    expect(t("Open review session")).toBe("İnceleme oturumunu aç");
    expect(
      t(
        "This conversation is running in the background on this computer. New messages appear automatically.",
      ),
    ).toBe(
      "Bu konuşma bu bilgisayarda arka planda devam ediyor. Yeni mesajlar otomatik olarak görünür.",
    );
  });
  it("defaults Git and technical controls to English independently of the application", async () => {
    await languageReady;
    await setLanguagePreference("tr");
    expect(getDomainLanguagePreference("git")).toBe("en");
    expect(getDomainLanguagePreference("technical")).toBe("en");
    expect(t("Cancel")).toBe("İptal");
    expect(gitText("Cancel")).toBe("Cancel");
    expect(technicalText("Cancel")).toBe("Cancel");
    await setDomainLanguagePreference("git", "app");
    await setDomainLanguagePreference("technical", "ja");
    expect(gitText("Cancel")).toBe("İptal");
    expect(getLocale("technical")).toBe("ja");
    await setLanguagePreference("de");
    expect(gitText("Cancel")).toBe(t("Cancel"));
    expect(getLocale("technical")).toBe("ja");
    expect(document.documentElement.lang).toBe("de");
    expect(localStorage.getItem(DOMAIN_LANGUAGE_STORAGE_KEYS.git)).toBe("app");
    expect(localStorage.getItem(DOMAIN_LANGUAGE_STORAGE_KEYS.technical)).toBe("ja");
  });
  it("synchronizes domain choices across windows and defaults cleared preferences to English", async () => {
    localStorage.setItem(DOMAIN_LANGUAGE_STORAGE_KEYS.git, "tr");
    window.dispatchEvent(new StorageEvent("storage", { key: DOMAIN_LANGUAGE_STORAGE_KEYS.git }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(gitText("Cancel")).toBe("İptal");
    localStorage.removeItem(DOMAIN_LANGUAGE_STORAGE_KEYS.git);
    window.dispatchEvent(new StorageEvent("storage", { key: DOMAIN_LANGUAGE_STORAGE_KEYS.git }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(gitText("Cancel")).toBe("Cancel");
  });
  it("resolves regional and unsupported system languages", () => {
    expect(resolveLocale(["tr-TR", "en-US"])).toBe("tr");
    expect(resolveLocale(["pt-BR"])).toBe("pt");
    expect(resolveLocale(["zh-Hans-CN"])).toBe("zh-CN");
    expect(resolveLocale(["ko-KR", "ja-JP"])).toBe("ja");
    expect(resolveLocale(["xx"])).toBe("en");
  });
  it("loads every bundled catalog and persists the selected language", async () => {
    await languageReady;
    for (const language of LANGUAGES) {
      await setLanguagePreference(language.value);
      expect(getLocale()).toBe(language.value);
      expect(document.documentElement.lang).toBe(language.value);
      expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe(language.value);
      expect(t("General").length).toBeGreaterThan(0);
    }
    await setLanguagePreference("tr");
    expect(t("Settings")).toBe("Ayarlar");
    expect(settingsSectionLabel("general")).toBe("Genel");
    expect(searchSettings("dil").map((result) => result.settingId)).toEqual(
      expect.arrayContaining(["interface-language", "git-language", "technical-language"]),
    );
  });
  it("preserves values, braces and unknown provider text", async () => {
    await setLanguagePreference("tr");
    const value = "C:\\work\\{p1} <script> literal";
    expect(t("Ask · {p0}", { p0: value })).toContain(value);
    expect(t("An unknown provider message")).toBe("An unknown provider message");
    expect(t("Ask · {p0}")).toContain("{p0}");
    expect(formatNumber(1234.5)).toBe(new Intl.NumberFormat("tr").format(1234.5));
    expect(formatDate(new Date(2026, 9, 8), { month: "long" })).toBe("Ekim");
  });
  it("updates another window's language preference", async () => {
    await setLanguagePreference("en");
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "tr");
    window.dispatchEvent(
      new StorageEvent("storage", { key: LANGUAGE_STORAGE_KEY, newValue: "tr" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getLanguagePreference()).toBe("tr");
    expect(getLocale()).toBe("tr");
  });
  it("changes labels without remounting an edited input", async () => {
    await setLanguagePreference("en");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let mounted = 0;
    function Draft() {
      useLocale();
      useGitLocale();
      const [draft] = useState(() => {
        mounted++;
        return "My unsent draft";
      });
      return createElement(
        "div",
        null,
        createElement("input", { defaultValue: draft }),
        createElement("button", null, t("Cancel")),
        createElement("span", { "data-testid": "git-label" }, gitText("Cancel")),
        createElement(LanguageSettings),
      );
    }
    try {
      await act(async () => root.render(createElement(Draft)));
      const input = container.querySelector("input")!;
      input.value = "Türkçe taslak {p0}";
      await act(async () => {
        await setLanguagePreference("tr");
      });
      expect(container.querySelector("input")).toBe(input);
      expect(input.value).toBe("Türkçe taslak {p0}");
      expect(container.textContent).toContain("İptal");
      expect(container.querySelector('[data-setting-id="interface-language"]')).not.toBeNull();
      expect(mounted).toBe(1);
      expect(container.querySelector('[data-testid="git-label"]')?.textContent).toBe("Cancel");
      await act(async () => {
        await setDomainLanguagePreference("git", "tr");
      });
      expect(container.querySelector('[data-testid="git-label"]')?.textContent).toBe("İptal");
      expect(container.querySelector("input")).toBe(input);
      expect(input.value).toBe("Türkçe taslak {p0}");
      expect(mounted).toBe(1);
      expect(container.querySelector('[data-setting-id="git-language"]')).not.toBeNull();
      expect(container.querySelector('[data-setting-id="technical-language"]')).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});

it("Yeni CI parite metinlerini Türkçe sunar", async () => {
  await setLanguagePreference("tr");
  expect(t("Pipeline commit")).toBe("Pipeline commit'i");
  expect(t("Failure allowed")).toBe("Hata kabul edilebilir");
  expect(t("Open {p0} check", { p0: "build" })).toBe("build kontrolünü aç");
  expect(t("Account changed; reload checks before repairing.")).toBe(
    "Hesap değişti; düzeltmeden önce kontrolleri yeniden yükle.",
  );
});
