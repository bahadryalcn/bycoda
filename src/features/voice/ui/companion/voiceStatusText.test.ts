import { expect, it } from "vitest";
import { voiceStatusText } from "./voiceStatusText";

const base = {
  status: "live",
  muted: false,
  playback: false,
  phase: "replying",
  hearingInput: false,
  realtime: true,
} as const;

it("keeps the existing lines when the new inputs are absent", () => {
  expect(voiceStatusText(base)).toBe("Preparing a reply…");
  expect(voiceStatusText({ ...base, phase: "listening" })).toBe("Listening");
  expect(voiceStatusText({ ...base, playback: true })).toBe("Assistant speaking");
  expect(voiceStatusText({ ...base, status: "reconnecting" })).toBe("Reconnecting…");
});

it("shows tool work instead of preparing a reply, with the target when known", () => {
  expect(voiceStatusText({ ...base, tool: { name: "give_jobs" } })).toBe("Working: give_jobs");
  expect(voiceStatusText({ ...base, tool: { name: "Create session", target: "monocode" } })).toBe(
    "Working: Create session · monocode",
  );
});

it("lets an owner wait win over a running tool and the reply line", () => {
  const tool = { name: "give_jobs" };
  expect(voiceStatusText({ ...base, waitingOwner: "question", tool })).toBe(
    "Waiting for your answer",
  );
  expect(voiceStatusText({ ...base, waitingOwner: "review", tool })).toBe(
    "Waiting for your approval",
  );
});

it("does not override speaking, transcribing or non-live states", () => {
  const extra = { waitingOwner: "question", tool: { name: "x" } } as const;
  expect(voiceStatusText({ ...base, ...extra, playback: true })).toBe("Assistant speaking");
  expect(voiceStatusText({ ...base, ...extra, phase: "transcribing" })).toBe(
    "Transcribing locally…",
  );
  expect(voiceStatusText({ ...base, ...extra, status: "ready" })).toBe("Ready. Microphone is off.");
});
