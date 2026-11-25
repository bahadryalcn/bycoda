import { describe, expect, it } from "vitest";
import {
  classifyVoiceFailure,
  recentVoiceContext,
  VOICE_RECONNECT_DELAYS,
  voiceLostSpeechNotice,
  voiceResumeTurns,
} from "./voiceReconnect";

describe("voice conversation resume", () => {
  const user = (text: string) => ({ role: "user" as const, text });
  const assistant = (text: string) => ({ role: "assistant" as const, text });

  it("restores accepted turns the Host has not stored, once and in order", () => {
    expect(
      voiceResumeTurns(
        [user("ilk"), assistant("yanıt")],
        [user("ilk"), assistant("yanıt"), user("son istek")],
      ),
    ).toEqual([user("ilk"), assistant("yanıt"), user("son istek")]);
  });

  it("keeps a repeated sentence that really was said twice", () => {
    expect(voiceResumeTurns([user("tamam")], [user("tamam"), user("tamam")])).toEqual([
      user("tamam"),
      user("tamam"),
    ]);
  });

  it("matches a locally tail-trimmed turn against its full stored text", () => {
    const full = `${"a".repeat(5000)}son`;
    expect(voiceResumeTurns([user(full)], [user(full.slice(-4000))])).toEqual([user(full)]);
  });

  it("keeps the six-turn bound", () => {
    const local = Array.from({ length: 8 }, (_, index) => user(`turn ${index}`));
    expect(voiceResumeTurns([], local)).toEqual(local.slice(-6));
  });

  it("asks once for only the lost speech and never replays an action", () => {
    const alone = voiceLostSpeechNotice();
    expect(alone).toContain("ask them once to repeat only");
    expect(alone).toContain("do not repeat any action");
    const withRequest = voiceLostSpeechNotice(`  ${"x".repeat(400)}  `);
    expect(withRequest).toContain("last received request");
    expect(withRequest).not.toContain("x".repeat(301));
    expect(alone).toContain("Work this voice assistant started");
    expect(alone).toContain("never say work was not started unless that state confirms it");
  });
});

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

  it("permits fresh-session recovery from a cleanup delivery timeout without weakening credential failures", () => {
    expect(
      classifyVoiceFailure(
        "Voice input cleanup was not confirmed. Start voice again.",
        "input_cleanup_unconfirmed",
      ),
    ).toEqual({ recoverable: true, code: "input_cleanup_unconfirmed" });
    expect(
      classifyVoiceFailure("Authentication rejected (401)", "input_cleanup_unconfirmed")
        .recoverable,
    ).toBe(false);
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
      content: [{ type: "output_text", text: "Done" }],
    });
  });
});
