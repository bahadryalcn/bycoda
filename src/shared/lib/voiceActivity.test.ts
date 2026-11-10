import { beforeEach, describe, expect, it } from "vitest";
import {
  noteVoiceActivity,
  resetVoiceActivityForTest,
  takeVoiceActivityReport,
} from "./voiceActivity";

describe("voice activity reports", () => {
  beforeEach(resetVoiceActivityForTest);
  it("reports nothing before accepted speech", () => {
    expect(takeVoiceActivityReport(1_000)).toBeUndefined();
  });
  it("reports fresh speech once, then at most every 30 s while it continues", () => {
    noteVoiceActivity(1_000);
    expect(takeVoiceActivityReport(4_000)).toBe(3_000);
    expect(takeVoiceActivityReport(5_000)).toBeUndefined();
    noteVoiceActivity(20_000);
    expect(takeVoiceActivityReport(21_000)).toBeUndefined();
    expect(takeVoiceActivityReport(35_000)).toBe(15_000);
  });
  it("drops stale speech", () => {
    noteVoiceActivity(0);
    expect(takeVoiceActivityReport(120_000)).toBeUndefined();
  });
});
