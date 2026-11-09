import { expect, it } from "vitest";
import { settingsProfilePatch, SETTINGS_PROFILE_FIELDS } from "./settingsPatch";

it("saves every new personality and job-confirmation field from the settings draft", () => {
  const patch = settingsProfilePatch({
    addressFrequency: "never",
    tone: "casual",
    allowProfanity: true,
    persona: "Short answers",
    confirmJobs: true,
    voiceNarration: true,
    notificationDnd: "none",
    name: "Arif",
    version: 9,
  } as never);
  expect(patch).toMatchObject({
    addressFrequency: "never",
    tone: "casual",
    allowProfanity: true,
    persona: "Short answers",
    confirmJobs: true,
    voiceNarration: true,
    notificationDnd: "none",
    name: "Arif",
  });
  expect(Object.keys(patch)).not.toContain("version");
});

it("lists each editable profile field once", () => {
  expect(new Set(SETTINGS_PROFILE_FIELDS).size).toBe(SETTINGS_PROFILE_FIELDS.length);
});
