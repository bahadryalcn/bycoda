import { describe, expect, it } from "vitest";
import { classifyVoiceFailure, recentVoiceContext, VOICE_RECONNECT_DELAYS } from "./voiceReconnect";

describe("voice reconnection admission", () => {
  it.each([
    new DOMException("Capture blocked", "NotAllowedError"),
    new Error("API authentication failed"),
    new Error("Insufficient quota"),
    new Error("Please sign in. Sign in required"),
    new Error("OpenAI sign-in was rejected (401). Sign in to Codex."),
    new Error("Grok Voice is unavailable (402)."),
  ])("requires owner action for credentials, billing or permission: %s", (error) => {
    expect(classifyVoiceFailure(error).recoverable).toBe(false);
  });

  it.each(["Voice connection timed out.", "Voice connection closed.", "Microphone lost."])(
    "can retry transient failure: %s",
    (error) => {
      expect(classifyVoiceFailure(error).recoverable).toBe(true);
    },
  );

  it("uses provider codes as well as public error text", () => {
    expect(classifyVoiceFailure("Request failed", "invalid_api_key")).toEqual({
      recoverable: false,
      code: "invalid_api_key",
    });
    expect(VOICE_RECONNECT_DELAYS).toEqual([1_000, 2_000, 5_000, 10_000, 30_000]);
  });

  it("re-seeds only bounded text without authorizing a response or repeating a tool", () => {
    const events = recentVoiceContext(
      Array.from({ length: 10 }, (_, i) => ({
        role: "user" as const,
        text: String(i).repeat(5_000),
      })),
    );
    expect(events).toHaveLength(6);
    expect(events[0].item.content[0].text).toBe("4".repeat(4_000));
    expect(events.every((event) => event.type === "conversation.item.create")).toBe(true);
    expect(recentVoiceContext([{ role: "assistant", text: "Done" }])[0].item).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Done" }],
    });
  });
});
