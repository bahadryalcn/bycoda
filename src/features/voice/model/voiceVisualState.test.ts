import { expect, it } from "vitest";
import { voiceVisualState } from "./voiceVisualState";
const live = {
  status: "live",
  phase: "listening",
  muted: false,
  playback: false,
  error: "",
} as const;
it("maps every voice lifecycle and gives errors and pause priority over playback", () => {
  expect(voiceVisualState({ ...live, status: "idle" })).toBe("off");
  expect(voiceVisualState({ ...live, status: "connecting" })).toBe("connecting");
  expect(voiceVisualState(live)).toBe("listening");
  expect(voiceVisualState({ ...live, phase: "speaking" })).toBe("user");
  for (const phase of ["transcribing", "replying"] as const)
    expect(voiceVisualState({ ...live, phase })).toBe("thinking");
  expect(voiceVisualState({ ...live, playback: true })).toBe("assistant");
  expect(voiceVisualState({ ...live, playback: true, muted: true })).toBe("muted");
  expect(voiceVisualState({ ...live, status: "idle", error: "Disconnected" })).toBe("error");
  expect(voiceVisualState({ ...live, muted: true, playback: true, error: "Failed" })).toBe("error");
});
