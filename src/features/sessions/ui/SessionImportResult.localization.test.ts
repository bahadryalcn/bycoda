import { afterEach, expect, it } from "vitest";
import { setLanguagePreference, t } from "../../../shared/i18n";
import { importFailureMessage } from "./SessionImportResult";

afterEach(async () => {
  await setLanguagePreference("en");
});

it("localizes application import failures in the active language", async () => {
  await setLanguagePreference("de");

  expect(importFailureMessage(t, "noMessages")).toBe(
    "Die Unterhaltung hat keine Nachrichten zum Importieren",
  );
  expect(importFailureMessage(t, "unsupportedId")).toBe("Nicht unterstützte Unterhaltungs-ID");
});
