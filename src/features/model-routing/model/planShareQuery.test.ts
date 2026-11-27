import { expect, it } from "vitest";
import { planShareFingerprint, planShareObservations, samePlanShareScope } from "./planShareQuery";

const sample = (
  account: string,
  kind: "session" | "weekly" | "monthly",
  at: number,
  used = 10,
) => ({
  account,
  at,
  kind,
  used,
  minutes: 300,
  resetsAt: null,
});

it("keeps only the requested window kind and accounts", () => {
  const samples = [
    sample("claude:a", "session", 1),
    sample("claude:a", "weekly", 2),
    sample("codex:b", "session", 3),
    sample("claude:a", "monthly", 4),
  ];
  expect(planShareObservations(samples, "fiveHour").map((entry) => entry.at)).toEqual([1, 3]);
  expect(planShareObservations(samples, "weekly").map((entry) => entry.at)).toEqual([2]);
  expect(
    planShareObservations(samples, "fiveHour", ["codex:b"]).map((entry) => entry.account),
  ).toEqual(["codex:b"]);
});

it("fingerprints the newest reading per account", () => {
  const first = planShareObservations([sample("claude:a", "session", 1)], "fiveHour");
  const second = planShareObservations(
    [sample("claude:a", "session", 1), sample("claude:a", "session", 5)],
    "fiveHour",
  );
  expect(planShareFingerprint(first)).not.toBe(planShareFingerprint(second));
  expect(planShareFingerprint(second)).toBe('[["claude:a",5]]');
});

it("keeps an estimate across quota readings but not across windows", () => {
  const key = (window: string, fingerprint: string) => [
    "usage",
    "m1",
    window,
    undefined,
    5,
    fingerprint,
  ];
  expect(samePlanShareScope(key("fiveHour", "a"), key("fiveHour", "b"))).toBe(true);
  expect(samePlanShareScope(key("fiveHour", "a"), key("weekly", "a"))).toBe(false);
});
