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

it("reports social image runs once per group instead of on every launch", () => {
  const report = createProbeGrantWarningFilter();
  expect(report("social-image-0b0e5e0a-1111-4222-8333-444455556666", "conversation")).toBe(true);
  expect(report("social-image-7c1d2e3f-1111-4222-8333-444455556666", "conversation")).toBe(false);
  expect(report("social-image-7c1d2e3f-1111-4222-8333-444455556666", "social")).toBe(true);
  // A look-alike id is a real session, and a probe family is counted on its own.
  for (let i = 0; i < 2; i++) expect(report("social-images", "conversation")).toBe(true);
  expect(report("bycoda-codex-probe-one", "conversation")).toBe(true);
});
