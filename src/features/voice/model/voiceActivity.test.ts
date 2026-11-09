import { expect, it, vi } from "vitest";
import {
  claimVoiceConversationActivity,
  isVoiceConversationActive,
  subscribeVoiceConversationActivity,
} from "./voiceActivity";
it("tracks concurrent same-renderer conversation owners and releases activity without admitting microphone capture", () => {
  const changed = vi.fn();
  const unsubscribe = subscribeVoiceConversationActivity(changed);
  const first = claimVoiceConversationActivity(),
    second = claimVoiceConversationActivity();
  expect(isVoiceConversationActive()).toBe(true);
  expect(changed).toHaveBeenCalledOnce();
  first();
  first();
  expect(isVoiceConversationActive()).toBe(true);
  second();
  expect(isVoiceConversationActive()).toBe(false);
  expect(changed).toHaveBeenCalledTimes(2);
  unsubscribe();
});
