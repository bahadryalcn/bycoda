import { expect, it } from "vitest";
import {
  CHECKPOINT_FAILED_CODE,
  CHECKPOINT_RECORDING_CODE,
  classifyCheckpointFailure,
  RECORDING_POLL,
  recordingPollDelay,
} from "./checkpointRecording";

it("recognizes the typed recording and failed codes", () => {
  expect(classifyCheckpointFailure(new Error(`Busy [${CHECKPOINT_RECORDING_CODE}]`))).toBe(
    "recording",
  );
  expect(classifyCheckpointFailure(`Disk full [${CHECKPOINT_FAILED_CODE}]`)).toBe("failed");
  expect(classifyCheckpointFailure({ code: CHECKPOINT_RECORDING_CODE, message: "x" })).toBe(
    "recording",
  );
  expect(classifyCheckpointFailure({ code: CHECKPOINT_FAILED_CODE, message: "x" })).toBe("failed");
});

it("keeps recognizing the legacy English messages of an older Host", () => {
  expect(
    classifyCheckpointFailure(new Error("Workspace checkpoint is still recording this turn")),
  ).toBe("recording");
  expect(
    classifyCheckpointFailure(
      "Host rejected request: Workspace checkpoint is still recording this turn",
    ),
  ).toBe("recording");
  expect(classifyCheckpointFailure(new Error("Workspace checkpoint failed: no space"))).toBe(
    "failed",
  );
  expect(
    classifyCheckpointFailure("Host rejected request: Workspace checkpoint failed: no space"),
  ).toBe("failed");
});

it("does not mistake other failures for a checkpoint state", () => {
  expect(classifyCheckpointFailure(new Error("Connection unavailable"))).toBe("other");
  expect(classifyCheckpointFailure(null)).toBe("other");
  expect(classifyCheckpointFailure("An earlier note: Workspace checkpoint failed: x")).toBe(
    "other",
  );
});

it("backs off exponentially up to the cap", () => {
  const delays = Array.from({ length: RECORDING_POLL.maxAttempts }, (_, attempt) =>
    recordingPollDelay(attempt),
  );
  expect(delays).toEqual([1000, 2000, 4000, 8000, 8000, 8000, 8000, 8000]);
  expect(recordingPollDelay(-3)).toBe(RECORDING_POLL.baseMs);
  expect(recordingPollDelay(100)).toBe(RECORDING_POLL.maxMs);
});

it("bounds the whole recording wait so a stuck checkpoint cannot poll forever", () => {
  const totalMs = Array.from({ length: RECORDING_POLL.maxAttempts }, (_, attempt) =>
    recordingPollDelay(attempt),
  ).reduce((sum, ms) => sum + ms, 0);
  expect(Number.isFinite(RECORDING_POLL.maxAttempts)).toBe(true);
  expect(RECORDING_POLL.maxAttempts).toBeGreaterThan(0);
  expect(totalMs).toBeLessThanOrEqual(60_000);
});
