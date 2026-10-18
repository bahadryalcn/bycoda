// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

afterEach(() => vi.restoreAllMocks());

it("persists dismissal across app reloads and expires after 24 hours", async () => {
  const now = Date.now();
  const initial = await import("./updatePrompt");
  expect(initial.isUpdatePromptSnoozed(now)).toBe(false);
  initial.snoozeUpdatePrompt(now);
  vi.resetModules();
  const reloaded = await import("./updatePrompt");
  expect(reloaded.isUpdatePromptSnoozed(now + initial.UPDATE_PROMPT_SNOOZE_MS - 1)).toBe(true);
  expect(reloaded.isUpdatePromptSnoozed(now + initial.UPDATE_PROMPT_SNOOZE_MS)).toBe(false);
});

it("keeps dismissal effective when storage is blocked", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage disabled");
  });
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Storage disabled");
  });
  const policy = await import("./updatePrompt");
  const now = Date.now();
  expect(() => policy.snoozeUpdatePrompt(now)).not.toThrow();
  expect(policy.isUpdatePromptSnoozed(now + 1)).toBe(true);
  expect(policy.isUpdatePromptSnoozed(now + policy.UPDATE_PROMPT_SNOOZE_MS)).toBe(false);
});

it.each(["invalid", "Infinity", "-1", String(Number.MAX_VALUE)])(
  "ignores invalid or unreasonable stored deadlines: %s",
  async (value) => {
    localStorage.setItem("bycoda.updatePrompt.snooze.v1", value);
    const policy = await import("./updatePrompt");
    expect(policy.isUpdatePromptSnoozed()).toBe(false);
  },
);
