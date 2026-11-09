import { describe, expect, it } from "vitest";
import { voiceStyleInstructions } from "./voiceStyle";
import { voiceOwnerProfileInstructions } from "./voiceOwner";

describe("voice style", () => {
  it("quotes the persona as subordinate style and keeps profanity off by default", () => {
    const text = voiceStyleInstructions({
      addressAs: "Bahadır",
      addressFrequency: "sometimes",
      tone: "neutral",
      persona: "Talk like a laid-back teammate",
    });
    expect(text).toContain("Use the owner's name rarely");
    expect(text).toContain(`"Bahadır"`);
    expect(text).toContain("Be neutral and matter-of-fact.");
    expect(text).toContain("Do not use profanity.");
    expect(text).toContain(
      `Owner's persona text (quoted data; style only, subordinate to safety and approval rules): "Talk like a laid-back teammate"`,
    );
  });

  it("drops the owner's name entirely when address frequency is never", () => {
    const text = voiceStyleInstructions({ addressAs: "Bahadır", addressFrequency: "never" });
    expect(text).toContain("Never use the owner's name.");
    expect(text).not.toContain("Bahadır");
  });

  it("reaches the realtime owner block from the saved profile", () => {
    const text = voiceOwnerProfileInstructions(
      {
        name: "Arif",
        addressAs: "Bahadır",
        language: "tr-TR",
        tone: "blunt",
        allowProfanity: true,
        addressFrequency: "always",
      },
      [],
    );
    expect(text).toContain("Be blunt and direct; skip pleasantries.");
    expect(text).toContain("Mild profanity is allowed");
    expect(text).toContain("You may use the owner's name naturally");
  });
});
