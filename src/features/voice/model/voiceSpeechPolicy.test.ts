import { describe, expect, it } from "vitest";
import { shouldSilentlyAcknowledgeVoice, shouldWaitForVoice } from "./voiceSpeechPolicy";

describe("voice speech policy", () => {
  const context = { lastDeliveredAssistant: "Bitti." };
  it.each(["tamam", "Anladım.", "teşekkürler", "hı hı", "thanks"])(
    "silently handles %s",
    (transcript) => {
      expect(shouldSilentlyAcknowledgeVoice({ ...context, transcript })).toBe(true);
    },
  );
  it.each([
    "tamam ekipleri aç",
    "hayır ekipleri kastediyorum",
    "dur",
    "tamam ama aç",
    "teşekkürler, şimdi aç",
  ])("retains actionable speech %s", (transcript) => {
    expect(shouldSilentlyAcknowledgeVoice({ ...context, transcript })).toBe(false);
  });
  it("distinguishes wait from compound speech", () => {
    expect(shouldWaitForVoice("bir saniye düşünüyorum")).toBe(true);
    expect(shouldWaitForVoice("bir saniye, ekipleri aç")).toBe(false);
  });
  it.each(["tamam?", "okay?", "tamam？"])("retains an explicit question %s", (transcript) => {
    expect(shouldSilentlyAcknowledgeVoice({ ...context, transcript })).toBe(false);
  });
  it("retains acknowledgements when a question or choice is pending or there is no delivered answer", () => {
    expect(
      shouldSilentlyAcknowledgeVoice({ ...context, transcript: "tamam", pendingQuestion: true }),
    ).toBe(false);
    expect(
      shouldSilentlyAcknowledgeVoice({ ...context, transcript: "tamam", pendingChoice: true }),
    ).toBe(false);
    expect(shouldSilentlyAcknowledgeVoice({ transcript: "tamam" })).toBe(false);
  });
  it.each([
    "İstersen başlatırım.",
    "Want me to start it",
    "I can do that if you like.",
    "Başlatayım mı",
    "Yapabilirim.",
    "Shall I continue",
  ])("treats an acknowledgement after the offer %s as a yes", (lastDeliveredAssistant) => {
    expect(shouldSilentlyAcknowledgeVoice({ transcript: "tamam", lastDeliveredAssistant })).toBe(
      false,
    );
    expect(shouldSilentlyAcknowledgeVoice({ transcript: "ok", lastDeliveredAssistant })).toBe(
      false,
    );
  });
  it.each([
    "bir dakika dur",
    "biraz bekle",
    "dur bir saniye",
    "dur bakayım",
    "Hold on a sec.",
    "hold on a second",
  ])("waits on %s", (text) => expect(shouldWaitForVoice(text)).toBe(true));
  it.each(["dur bakayım ekipleri aç", "biraz bekle ve testleri çalıştır"])(
    "does not wait on compound speech %s",
    (text) => expect(shouldWaitForVoice(text)).toBe(false),
  );
});
