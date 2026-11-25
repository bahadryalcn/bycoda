import { expect, it } from "vitest";
import { VOICE_JOB_REVIEW_NO_ANSWER, voiceJobReviewExpiry } from "./voiceJobReviewTimeout";

const review = { busy: false, accepted: [] as string[], error: "" };

it("closes an untouched review with a truthful nothing-created result", () => {
  expect(voiceJobReviewExpiry(review, false)).toBe("close");
  expect(voiceJobReviewExpiry(review, true)).toBe("close");
  expect(VOICE_JOB_REVIEW_NO_ANSWER).toMatchObject({ status: "cancelled", reason: "no_answer" });
  expect(VOICE_JOB_REVIEW_NO_ANSWER.error).toMatch(/Nothing was created/);
});

it("keeps a failed or partial start visible and only releases its tool call once", () => {
  expect(voiceJobReviewExpiry({ ...review, error: "Unknown" }, false)).toBe("release");
  expect(voiceJobReviewExpiry({ ...review, accepted: ["j1"] }, false)).toBe("release");
  expect(voiceJobReviewExpiry({ ...review, accepted: ["j1"] }, true)).toBe("keep");
});

it("lets a start in progress finish", () => {
  expect(voiceJobReviewExpiry({ ...review, busy: true }, false)).toBe("keep");
});
