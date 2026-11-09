import { expect, it } from "vitest";
import { assistantBriefingText, assistantUpdateFallback } from "./briefing";

it("speaks actual Turkish text for a Turkish owner rather than English text with a Turkish voice", () => {
  const text = assistantBriefingText("tr-TR", {
    waiting: 2,
    done: 5,
    updates: 8,
    hour: 9,
    addressAs: "Kadir",
  });
  expect(text).toBe(
    "Günaydın, Kadir. 2 iş ilgini bekliyor. Sen yokken 5 iş tamamlandı. Geçmiş'te 8 güncelleme var.",
  );
  expect(
    assistantBriefingText("tr-TR", {
      waiting: 0,
      done: 1,
      updates: 1,
      hour: 20,
    }),
  ).toContain("Tekrar hoş geldin");
  expect(assistantUpdateFallback("tr-TR")).not.toContain("Open the linked job");
});
it("omits sentences whose count is zero and keeps the rest", () => {
  expect(
    assistantBriefingText("tr-TR", {
      waiting: 0,
      done: 3,
      updates: 0,
      hour: 9,
      addressAs: "Kadir",
    }),
  ).toBe("Günaydın, Kadir. Sen yokken 3 iş tamamlandı.");
  expect(
    assistantBriefingText("tr-TR", {
      waiting: 1,
      done: 0,
      updates: 4,
      hour: 20,
    }),
  ).toBe("Tekrar hoş geldin. 1 iş ilgini bekliyor. Geçmiş'te 4 güncelleme var.");
});
it("keeps only the greeting when every count is zero", () => {
  expect(
    assistantBriefingText("en-US", {
      waiting: 0,
      done: 0,
      updates: 0,
      hour: 9,
    }),
  ).toBe("Good morning.");
  expect(
    assistantBriefingText("tr-TR", {
      waiting: 0,
      done: 0,
      updates: 0,
      hour: 20,
      addressAs: "Bahadır",
    }),
  ).toBe("Tekrar hoş geldin, Bahadır.");
});
it("does not print a zero count anywhere in the summary", () => {
  const text = assistantBriefingText("en-US", {
    waiting: 0,
    done: 2,
    updates: 0,
    hour: 9,
  });
  expect(text).not.toMatch(/\b0\b/);
  expect(text).toBe("Good morning. 2 jobs finished while you were away.");
});
it.each(["en-US", "de-DE", "fr-FR", "es-ES", "pt-PT", "zh-CN", "ja-JP"])(
  "renders complete bounded counts for %s without a model call",
  (language) => {
    const text = assistantBriefingText(language, {
      waiting: 2,
      done: 5,
      updates: 8,
      hour: 9,
    });
    expect(text).toContain("2");
    expect(text).toContain("5");
    expect(text).toContain("8");
    expect(text.length).toBeLessThan(1000);
    if (language !== "en-US") expect(text).not.toContain("jobs need your attention");
  },
);
