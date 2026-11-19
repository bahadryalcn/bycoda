import { expect, it } from "vitest";
import { CHAT_TAIL_PX, isAtChatTail } from "./voiceChatScroll";

it("follows the tail only while the reader rests at the end", () => {
  const view = { scrollHeight: 1000, clientHeight: 200 };
  expect(isAtChatTail({ ...view, scrollTop: 800 })).toBe(true);
  expect(isAtChatTail({ ...view, scrollTop: 800 - CHAT_TAIL_PX })).toBe(true);
  expect(isAtChatTail({ ...view, scrollTop: 800 - CHAT_TAIL_PX - 1 })).toBe(false);
  expect(isAtChatTail({ ...view, scrollTop: 0 })).toBe(false);
});

it("treats a transcript that fits without scrolling as at the tail", () => {
  expect(isAtChatTail({ scrollTop: 0, scrollHeight: 120, clientHeight: 200 })).toBe(true);
});
