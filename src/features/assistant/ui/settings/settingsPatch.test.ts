import { expect, it, vi } from "vitest";
import {
  settingsProfilePatch,
  SETTINGS_PROFILE_FIELDS,
  validateTelegramNotificationTarget,
} from "./settingsPatch";

it("saves every new personality and job-confirmation field from the settings draft", () => {
  const patch = settingsProfilePatch({
    addressFrequency: "never",
    tone: "casual",
    allowProfanity: true,
    persona: "Short answers",
    confirmJobs: true,
    voiceNarration: true,
    notificationDnd: "none",
    name: "Arif",
    version: 9,
  } as never);
  expect(patch).toMatchObject({
    addressFrequency: "never",
    tone: "casual",
    allowProfanity: true,
    persona: "Short answers",
    confirmJobs: true,
    voiceNarration: true,
    notificationDnd: "none",
    name: "Arif",
  });
  expect(Object.keys(patch)).not.toContain("version");
});

it("lists each editable profile field once", () => {
  expect(new Set(SETTINGS_PROFILE_FIELDS).size).toBe(SETTINGS_PROFILE_FIELDS.length);
});

it("retains away wakefulness and notification delivery choices on Save", () => {
  const draft = {
    keepAwakeWhileAway: false,
    urgentNotificationRepeats: 0,
    urgentNotificationIntervalMinutes: 45,
    notificationTelegram: {
      accountId: "telegram-account",
      conversationId: "existing-conversation",
    },
  };
  expect(settingsProfilePatch(draft)).toEqual(draft);
  expect(settingsProfilePatch({ notificationTelegram: null })).toEqual({
    notificationTelegram: null,
  });
});

it("does not retarget or reload an unchanged Telegram destination or an explicit Off", async () => {
  const target = { accountId: "a", conversationId: "original" };
  const read = vi.fn(async () => []);
  await validateTelegramNotificationTarget(
    { notificationTelegram: target },
    { notificationTelegram: { ...target } },
    read,
  );
  await validateTelegramNotificationTarget(
    { notificationTelegram: null },
    { notificationTelegram: target },
    read,
  );
  expect(read).not.toHaveBeenCalled();
});

it("rejects a newly selected conversation removed before Save", async () => {
  const draft = { notificationTelegram: { accountId: "a", conversationId: "selected" } };
  await expect(
    validateTelegramNotificationTarget(draft, {}, async () => [
      {
        accountId: "other",
        accountLabel: "Other",
        conversationId: "selected",
        conversationLabel: "Same name",
      },
    ]),
  ).rejects.toThrow("no longer allowed");
  await expect(
    validateTelegramNotificationTarget(draft, {}, async () => undefined),
  ).rejects.toThrow("no longer allowed");
  await expect(
    validateTelegramNotificationTarget(draft, {}, async () => [
      { ...draft.notificationTelegram, accountLabel: "Account", conversationLabel: "Selected" },
    ]),
  ).resolves.toBeUndefined();
});
