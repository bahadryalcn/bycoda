import { describe, expect, it } from "vitest";
import { withActiveYesterday } from "./dailySummaryActive";

const format = (m: number) => `${m}m`;
const label = (v: string) => `${v} active yesterday`;

describe("withActiveYesterday", () => {
  it("appends the line when there was activity", () => {
    expect(withActiveYesterday("2 finished", 90, format, label)).toBe(
      "2 finished · 90m active yesterday",
    );
  });

  it("leaves the headline alone without data or activity", () => {
    expect(withActiveYesterday("2 finished", null, format, label)).toBe("2 finished");
    expect(withActiveYesterday("2 finished", 0, format, label)).toBe("2 finished");
  });
});
