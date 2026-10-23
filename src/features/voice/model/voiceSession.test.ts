import { expect, it } from "vitest";
import type { Session } from "../../sessions/model/session";
import { clampVoicePosition, voiceContext } from "./voiceSession";
it("excludes tools and reasoning from bounded cloud context and redacts common secrets", () => {
  const context = voiceContext({
    title: "Session",
    blocks: [
      { role: "tool", text: "private tool output" },
      { role: "reasoning", text: "private reasoning" },
      { role: "assistant", text: "xai-abcdefghijklmnopqrst token=private Bearer hidden" },
    ],
  } as Session);
  const text = JSON.stringify(context);
  expect(text).not.toContain("private");
  expect(text).not.toContain("hidden");
  expect(text).toContain("[redacted]");
  expect(context.messages).toHaveLength(1);
});
it("keeps the companion within narrow viewports", () => {
  expect(clampVoicePosition(900, 700, 320, 200, 390, 600)).toEqual({ x: 62, y: 392 });
  expect(clampVoicePosition(-100, -30, 320, 200, 390, 600)).toEqual({ x: 8, y: 8 });
});
