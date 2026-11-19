import { afterEach, expect, it } from "vitest";
import { setLanguagePreference } from "../../../shared/i18n";
import { orchestrationTaskLabelText } from "./orchestrationTaskLabelText";

afterEach(() => setLanguagePreference("en"));

it("translates sidebar subagent status codes using the current language", async () => {
  await setLanguagePreference("tr");
  expect(orchestrationTaskLabelText("working")).toBe("Çalışıyor");
  expect(orchestrationTaskLabelText("needsInput")).toBe("Girdi gerekiyor");
  expect(orchestrationTaskLabelText("done")).toBe("Tamam");
  expect(orchestrationTaskLabelText("needsReview")).toBe("İnceleme gerekli");
});
