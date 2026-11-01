import { expect, it } from "vitest";
import { speechTranscript } from "./voiceTranscript";

it.each([
  "",
  " ... ",
  "[cough]",
  "[öksürük]",
  "(coughing)",
  "(boğaz temizleme)",
  "[keyboard] [breathing]",
  "<silence>",
])("does not interpret recognition event %j as speech", (text) => {
  expect(speechTranscript(text)).toBe("");
});

it.each([
  "evet",
  "hayır",
  "dur",
  "yes",
  "no",
  "stop",
  "Öksürük filtresini düzelt.",
  "Stop the work.",
  "1",
])("preserves actual short and normal speech %j", (text) => {
  expect(speechTranscript(text)).toBe(text);
});

it("keeps spoken words alongside non-speech annotations", () => {
  expect(speechTranscript("[cough] Evet. (breathing)")).toBe("Evet.");
  expect(speechTranscript("Set [name] to <value>.")).toBe("Set [name] to <value>.");
});
