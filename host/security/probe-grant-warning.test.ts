import { expect, it } from "vitest";
import { createProbeGrantWarningFilter } from "./probe-grant-warning";

it("deduplicates known probe warnings but retains every real-session failure", () => {
  const report = createProbeGrantWarningFilter();
  expect(report("bycoda-codex-probe-one", "conversation")).toBe(true);
  expect(report("bycoda-codex-probe-two", "conversation")).toBe(false);
  expect(report("bycoda-codex-probe-three", "social")).toBe(true);
  expect(report("bycoda-cursor-probe-one", "conversation")).toBe(true);
  for (const provider of ["claude", "grok"]) {
    expect(report(`bycoda-${provider}-probe-one`, "runtime-logs")).toBe(true);
    expect(report(`bycoda-${provider}-probe-two`, "runtime-logs")).toBe(false);
  }
  for (let i = 0; i < 3; i++) {
    expect(report("real-session", "conversation")).toBe(true);
    expect(report("owned-probe-test", "conversation")).toBe(true);
  }
});
