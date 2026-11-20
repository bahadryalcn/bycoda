import { beforeAll, describe, expect, it } from "vitest";
import { setLanguagePreference, translateAt } from "../../../shared/i18n/core";
import { taskClientErrors } from "./taskClientErrors";

describe("task and epic client errors", () => {
  beforeAll(async () => {
    await setLanguagePreference("tr");
    await setLanguagePreference("en");
  });
  // Regression: these messages reached the board untranslated because they were
  // thrown as English literals with no catalog entry for the other locales.
  it.each([
    ["machine", taskClientErrors.machine],
    ["agent", taskClientErrors.agent],
    ["sessionGone", taskClientErrors.sessionGone],
    ["epicChecking", taskClientErrors.epicChecking],
    ["epicReconnect", taskClientErrors.epicReconnect],
    ["epicUnchecked", taskClientErrors.epicUnchecked],
    ["epicScope", taskClientErrors.epicScope],
    ["epicUnresolved", taskClientErrors.epicUnresolved],
    ["epicAcknowledgement", taskClientErrors.epicAcknowledgement],
    ["chooseProject", taskClientErrors.chooseProject],
    ["goalMachine", taskClientErrors.goalMachine],
    ["goalVerifyHost", taskClientErrors.goalVerifyHost],
    ["goalDirectHost", taskClientErrors.goalDirectHost],
  ])("%s has a Turkish translation", (_name, message) => {
    const english = message();
    expect(translateAt("tr", english)).not.toBe(english);
  });

  it("keeps the English text when the locale has no translation", () => {
    expect(translateAt("en", taskClientErrors.epicChecking())).toBe(
      "Epic creation is already being checked.",
    );
  });
});
