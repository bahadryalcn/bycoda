import { expect, it } from "vitest";
import { AssistantProfilePatchSchema } from "./assistant-profile";
import {
  assistantProfileDefaults,
  readAssistantProfile,
} from "../../../../host/assistant/profile-defaults";

it("defaults away wakefulness and urgent reminders for old saved profiles", async () => {
  const profile = await readAssistantProfile({ get: async () => ({ enabled: true }) as never });
  expect(profile.keepAwakeWhileAway).toBe(true);
  expect(profile.urgentNotificationRepeats).toBe(2);
  expect(profile.urgentNotificationIntervalMinutes).toBe(30);
  expect(profile.notificationTelegram).toBeNull();
  expect(assistantProfileDefaults.keepAwakeWhileWorking).toBe(false);
});

it("validates explicit notification destinations and bounded repeat settings", () => {
  expect(
    AssistantProfilePatchSchema.parse({
      keepAwakeWhileAway: false,
      urgentNotificationRepeats: 0,
      urgentNotificationIntervalMinutes: 1,
      notificationTelegram: null,
    }).keepAwakeWhileAway,
  ).toBe(false);
  for (const patch of [
    { urgentNotificationRepeats: -1 },
    { urgentNotificationRepeats: 11 },
    { urgentNotificationIntervalMinutes: 0 },
    { urgentNotificationIntervalMinutes: 1441 },
    { notificationTelegram: { accountId: "", conversationId: "chat" } },
    { notificationTelegram: { accountId: "account", conversationId: "" } },
    { notificationTelegram: { accountId: "account", conversationId: "chat", owner: true } },
  ])
    expect(AssistantProfilePatchSchema.safeParse(patch).success).toBe(false);
  expect(
    AssistantProfilePatchSchema.parse({
      notificationTelegram: { accountId: "account", conversationId: "chat" },
    }).notificationTelegram,
  ).toEqual({ accountId: "account", conversationId: "chat" });
});
