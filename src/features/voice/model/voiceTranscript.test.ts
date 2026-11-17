import { expect, it } from "vitest";
import { removeSpeechFillers, speechTranscript } from "./voiceTranscript";

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

it("drops the recognizer's echoed vocabulary hint but keeps commands using those words", () => {
  expect(
    speechTranscript(
      "Ekipler, takımlar, görevler, projeler, oturumlar, otomasyonlar, notlar, gelen kutusu, yetenekler, cihazlar, tarayıcı.",
    ),
  ).toBe("");
  expect(speechTranscript("Bycoda. Crews, Tasks, Projects, Sessions, MCP.")).toBe("");
  // Recognizers reshape the echo: a colon, singular forms, different casing.
  expect(
    speechTranscript(
      "Bycoda: Ekipler, Takımlar, Görevler, Projeler, Oturumlar, Otomasyonlar, Notlar, Gelen Kutusu, Yetenekler, Cihazlar, Tarayıcı. Crew, Tasks, Projects, Sessions, MCP.",
    ),
  ).toBe("");
  expect(speechTranscript("Crew, task, project, session.")).toBe("");
  expect(speechTranscript("Projeler")).toBe("Projeler");
  expect(speechTranscript("Proje görev not ekle.")).toBe("Proje görev not ekle.");
  expect(speechTranscript("Ekipleri ve görevleri listele.")).toBe("Ekipleri ve görevleri listele.");
});

it.each([
  ["Eee, bunu şöyle yapalım.", "tr", "Bunu şöyle yapalım."],
  ["Bunu yap, eeee.", "tr", "Bunu yap."],
  ["Iıı... sonra testleri çalıştır", "tr", "Sonra testleri çalıştır"],
  ["Tamam. Hmm. Şimdi başla", "tr", "Tamam. Şimdi başla"],
  ["e, ne yapalım", "tr", "ne yapalım"],
  ["Ah, um, I think so", "en", "I think so"],
  ["Eee", "tr", ""],
])("removes the hesitations in %j", (text, language, expected) => {
  expect(removeSpeechFillers(text, { language })).toBe(expected);
});

it.each([
  ["I need this", "en"],
  ["Ben de geldim", "tr"],
  ["Ich bin um acht da", "de"],
  ["Hemen ekle", "tr"],
])("keeps real words in %j", (text, language) => {
  expect(removeSpeechFillers(text, { language })).toBe(text);
});
