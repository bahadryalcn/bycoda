import { expect, it } from "vitest";
import { narrationWanted } from "./voiceNarrationLifecycle";

it("runs the narration pump for reminders unless proactive speech is off", () => {
  expect(narrationWanted(undefined)).toBe(false);
  expect(narrationWanted({ voiceNarration: false, proactiveSpeech: "return" })).toBe(true);
  expect(narrationWanted({ proactiveSpeech: "important" })).toBe(true);
  expect(narrationWanted({ voiceNarration: false, proactiveSpeech: "never" })).toBe(false);
  expect(narrationWanted({ voiceNarration: true, proactiveSpeech: "never" })).toBe(true);
});
