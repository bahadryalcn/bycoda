import { expect, it } from "vitest";
import { maySpeakVoiceBriefing } from "./voiceBriefing";
import type { AssistantProfile } from "../../../shared/model/host-contracts/assistant";
const profile = { proactiveSpeech: "return", quietStart: 22, quietEnd: 8 } as AssistantProfile;
it("speaks only on an eligible return, respecting quiet hours and the owner's hold setting", () => {
  expect(maySpeakVoiceBriefing(profile, "active", "ready", false, 10)).toBe(true);
  for (const presence of ["away", "idle", "unknown"])
    expect(maySpeakVoiceBriefing(profile, presence, "ready", false, 10)).toBe(false);
  expect(maySpeakVoiceBriefing(profile, "active", "idle", false, 10)).toBe(false); // Explicit disconnect stays off.
  expect(maySpeakVoiceBriefing(profile, "active", "ready", true, 10)).toBe(false);
  expect(maySpeakVoiceBriefing(profile, "active", "ready", false, 23)).toBe(false);
  expect(maySpeakVoiceBriefing(profile, "active", "ready", false, 7)).toBe(false);
  expect(
    maySpeakVoiceBriefing({ ...profile, proactiveSpeech: "never" }, "active", "ready", false, 10),
  ).toBe(false);
});
