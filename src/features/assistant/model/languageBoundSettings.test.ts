import { describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/i18n", () => ({
  t: (key: string) => key,
  useT: () => (key: string) => key,
}));

const { baseLanguage, languageChange } = await import("./languageBoundSettings");

const turkish = { persona: "Rahat bir takım arkadaşı gibi konuş.", addressAs: "Efendim" };

describe("baseLanguage", () => {
  it("reduces regional tags and treats auto and blank as unknown", () => {
    expect(baseLanguage("tr-TR")).toBe("tr");
    expect(baseLanguage("zh_CN")).toBe("zh");
    expect(baseLanguage("auto")).toBeNull();
    expect(baseLanguage(" ")).toBeNull();
    expect(baseLanguage(undefined)).toBeNull();
  });
});

describe("languageChange", () => {
  it("lists persona and address for a fixed to fixed change", () => {
    const change = languageChange({ previous: "tr-TR", next: "en-US", profile: turkish });
    expect(change.from).toBe("tr-TR");
    expect(change.items.map((item) => item.key)).toEqual(["persona", "addressAs"]);
  });

  it("warns about nothing when no language-bound text is set", () => {
    const profile = { persona: "  ", addressAs: "" };
    expect(languageChange({ previous: "tr-TR", next: "en-US", profile }).items).toEqual([]);
  });

  it("does not warn when the base language stays", () => {
    expect(languageChange({ previous: "tr", next: "tr-TR", profile: turkish }).items).toEqual([]);
    expect(languageChange({ previous: "tr-TR", next: "tr-TR", profile: turkish }).items).toEqual(
      [],
    );
    expect(languageChange({ previous: undefined, next: "auto", profile: turkish }).items).toEqual(
      [],
    );
  });

  it("warns when switching to auto and names the previous language", () => {
    const change = languageChange({ previous: "tr-TR", next: "auto", profile: turkish });
    expect(change.from).toBe("tr-TR");
    expect(change.items).toHaveLength(2);
  });

  it("uses the last spoken language for a previous auto", () => {
    const change = languageChange({
      previous: "auto",
      next: "en-US",
      lastSpoken: "tr-TR",
      profile: turkish,
    });
    expect(change.from).toBe("tr-TR");
    expect(change.items).toHaveLength(2);
  });

  it("does not warn from auto to the language last spoken", () => {
    const change = languageChange({
      previous: "auto",
      next: "tr-TR",
      lastSpoken: "tr",
      profile: turkish,
    });
    expect(change.items).toEqual([]);
  });

  it("leaves the origin unknown from auto without a last spoken language", () => {
    const change = languageChange({ previous: "auto", next: "en-US", profile: turkish });
    expect(change.from).toBeNull();
    expect(change.items).toHaveLength(2);
  });

  it("includes voice phrases, dictionary and a conflicting dictation language", () => {
    const change = languageChange({
      previous: "tr-TR",
      next: "en-US",
      profile: {},
      voice: {
        wakePhrase: "hey asistan",
        sleepPhrase: "uyu",
        dictationDictionary: [{ term: "x" }],
        dictationLanguage: "tr",
      },
    });
    expect(change.items.map((item) => item.key)).toEqual([
      "wakePhrase",
      "sleepPhrase",
      "dictationDictionary",
      "dictationLanguage",
    ]);
  });

  it("ignores an auto or already matching dictation language", () => {
    const base = { previous: "tr", next: "en-US", profile: {} };
    expect(languageChange({ ...base, voice: { dictationLanguage: "en" } }).items).toEqual([]);
    expect(languageChange({ ...base, voice: { dictationLanguage: "auto" } }).items).toEqual([]);
  });
});
