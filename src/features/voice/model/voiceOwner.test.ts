// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { voiceOwnerInstructions } from "./voiceOwner";
import { DEFAULT_VOICE_PERSONA, saveVoicePersona } from "./voicePersona";
import type { AssistantSnapshot } from "../../../shared/model/host-contracts/assistant";

afterEach(() => localStorage.clear());

const persona = {
  ...DEFAULT_VOICE_PERSONA,
  status: "configured" as const,
  name: "Old name",
  userName: "Old owner",
  address: "formal",
  tone: "like a pirate",
  duties: ["explain"],
  customDuties: "remind me to drink water",
  rules: "Never interrupt me",
};
const snapshot = {
  profile: { name: "Ada", addressAs: "Sam", language: "en", tone: "casual" },
  memory: [],
} as unknown as AssistantSnapshot;

it("takes name, address and tone from the Assistant profile and ignores the old persona's", () => {
  saveVoicePersona(persona);
  const text = voiceOwnerInstructions(snapshot);
  expect(text).toContain('Your name is "Ada"');
  expect(text).toContain("Be relaxed and casual.");
  expect(text).not.toContain("pirate");
  expect(text).not.toContain("Old owner");
  expect(text).not.toContain("siz");
  expect(text).not.toContain("Focus on:");
  expect(text).not.toContain("drink water");
});

it("still quotes the legacy ground rules until they are migrated to the Host", () => {
  saveVoicePersona(persona);
  expect(voiceOwnerInstructions(snapshot)).toContain('"Never interrupt me"');
  localStorage.setItem("bycoda.voice.host-memory-migrated.v1", "done");
  expect(voiceOwnerInstructions(snapshot)).not.toContain("Never interrupt me");
});

it("keeps the full persona when no Assistant profile exists", () => {
  saveVoicePersona(persona);
  const text = voiceOwnerInstructions(null);
  expect(text).toContain('Tone: "like a pirate"');
  expect(text).toContain("Focus on:");
});
