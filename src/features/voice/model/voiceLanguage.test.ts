import { expect, it } from "vitest";
import { realtimeSession, voiceInstructions } from "./realtimeVoice";
import { voiceLanguageCode, voiceLanguageInstructions } from "./voiceLanguage";

it("keeps automatic language flexible and omits the transcription lock", () => {
  expect(voiceLanguageInstructions()).toBe("");
  expect(voiceInstructions("en")).toContain("in the language the user speaks");
  expect(realtimeSession("openai", "model", "en").audio?.input).toMatchObject({
    transcription: { model: "gpt-4o-mini-transcribe" },
  });
  expect(JSON.stringify(realtimeSession("openai", "model", "en"))).not.toContain('"language":');
});
it("locks both speech and transcription to the owner's chosen language", () => {
  expect(voiceInstructions("en", "", "tr-TR")).toContain("Her zaman Türkçe konuş");
  expect(
    realtimeSession("openai", "model", "en", undefined, "", "tr-TR").audio?.input,
  ).toMatchObject({ transcription: { language: "tr" } });
  expect(realtimeSession("xai", "model", "en", undefined, "", "tr-TR").instructions).toContain(
    "Always answer only in Turkish",
  );
  expect(voiceLanguageCode("bad language!")).toBeUndefined();
});
