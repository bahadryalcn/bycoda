import { expect, it } from "vitest";
import { mayDeliverVoiceBriefing, maySpeakVoiceBriefing } from "./voiceBriefing";
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

it("requires a fresh exact return receipt and a free conversation", () => {
  const input = {
    profile,
    presence: "active",
    status: "ready",
    hold: false,
    hour: 10,
    now: 100_000,
    briefing: { id: "return-1", createdAt: 99_000 },
    reason: "return" as const,
    returnAt: 98_000,
    returnBriefingId: "return-1",
    meaningful: true,
    conversationBusy: false,
    delivery: "pending" as const,
  };
  expect(mayDeliverVoiceBriefing(input)).toBe(true);
  expect(mayDeliverVoiceBriefing({ ...input, returnBriefingId: "daily" })).toBe(false);
  expect(mayDeliverVoiceBriefing({ ...input, returnAt: undefined })).toBe(false);
  expect(mayDeliverVoiceBriefing({ ...input, now: 500_000 })).toBe(false);
  expect(mayDeliverVoiceBriefing({ ...input, conversationBusy: true })).toBe(false);
  expect(mayDeliverVoiceBriefing({ ...input, meaningful: false })).toBe(false);
  expect(
    mayDeliverVoiceBriefing({ ...input, profile: { ...profile, proactiveSpeech: "important" } }),
  ).toBe(false);
  expect(
    mayDeliverVoiceBriefing({
      ...input,
      profile: { ...profile, proactiveSpeech: "important" },
      important: true,
    }),
  ).toBe(true);
  for (const delivery of ["playing", "delivered", "interrupted", "unknown"] as const)
    expect(mayDeliverVoiceBriefing({ ...input, delivery })).toBe(false);
  expect(mayDeliverVoiceBriefing({ ...input, presence: "unknown" })).toBe(false);
});

it("only allows classified important events with the important preference", () => {
  const input = {
    profile,
    presence: "active",
    status: "ready",
    hold: false,
    hour: 10,
    now: 100_000,
    briefing: { id: "event-1", createdAt: 99_000 },
    reason: "important" as const,
    meaningful: true,
    conversationBusy: false,
    delivery: "pending" as const,
  };
  expect(mayDeliverVoiceBriefing(input)).toBe(false);
  expect(
    mayDeliverVoiceBriefing({ ...input, profile: { ...profile, proactiveSpeech: "important" } }),
  ).toBe(true);
  expect(
    mayDeliverVoiceBriefing({ ...input, profile: { ...profile, proactiveSpeech: "never" } }),
  ).toBe(false);
});
