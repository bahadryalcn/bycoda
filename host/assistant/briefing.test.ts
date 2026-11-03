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
  expect(assistantBriefingText("tr-TR", { waiting: 0, done: 1, updates: 1, hour: 20 })).toContain(
    "Tekrar hoş geldin",
  );
  expect(assistantUpdateFallback("tr-TR")).not.toContain("Open the linked job");
});
it.each(["en-US", "de-DE", "fr-FR", "es-ES", "pt-PT", "zh-CN", "ja-JP"])(
  "renders complete bounded counts for %s without a model call",
  (language) => {
    const text = assistantBriefingText(language, { waiting: 2, done: 5, updates: 8, hour: 9 });
    expect(text).toContain("2");
    expect(text).toContain("5");
    expect(text).toContain("8");
    expect(text.length).toBeLessThan(1000);
    if (language !== "en-US") expect(text).not.toContain("jobs need your attention");
  },
);
