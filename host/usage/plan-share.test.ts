import { describe, expect, it } from "vitest";
import type { PlanShareObservation } from "../../src/shared/model/host-contracts/usage-plan-share";
import { computePlanShare, type PlanShareInput, type PlanShareTurn } from "./plan-share";

const H = 3_600_000;
const T0 = 1_000 * H;
const WINDOW = 300; // five hours
const RESET = T0 + 5 * H;

const obs = (
  account: string,
  hours: number,
  usedPercent: number,
  resetsAt: number | null = RESET,
): PlanShareObservation => ({
  account,
  at: T0 + hours * H,
  usedPercent,
  windowMinutes: WINDOW,
  resetsAt,
});
const turn = (
  account: string,
  hours: number,
  sessionId: string,
  costUsd: number | null,
  tokens = 1000,
): PlanShareTurn => ({ account, at: T0 + hours * H, sessionId, tokens, costUsd });

const run = (input: Partial<PlanShareInput>) =>
  computePlanShare({
    window: "fiveHour",
    now: T0 + 4 * H,
    observations: [],
    turns: [],
    limit: 10,
    ...input,
  });
const only = (input: Partial<PlanShareInput>) => {
  const [account] = run(input);
  return account;
};
const percentOf = (account: ReturnType<typeof only>, sessionId: string) =>
  account.jobs.find((job) => job.sessionId === sessionId)?.estimatedPercent;

describe("plan share", () => {
  it("splits an interval's increase across turns by cost weight", () => {
    const account = only({
      observations: [obs("claude:a", 2, 10)],
      turns: [turn("claude:a", 0.5, "s1", 3), turn("claude:a", 1, "s2", 1)],
    });
    expect(account.status).toBe("ok");
    expect(account.observedPercent).toBe(10);
    expect(percentOf(account, "s1")).toBe(7.5);
    expect(percentOf(account, "s2")).toBe(2.5);
    expect(account.untrackedPercent).toBe(0);
    expect(account.explainedPercent).toBe(10);
  });

  it("sums a session's turns and ranks jobs by estimate", () => {
    const account = only({
      observations: [obs("claude:a", 2, 8)],
      turns: [
        turn("claude:a", 0.5, "big", 1),
        turn("claude:a", 1, "small", 1),
        turn("claude:a", 1.5, "big", 2),
      ],
      limit: 1,
    });
    expect(account.jobs.map((job) => job.sessionId)).toEqual(["big"]);
    expect(account.jobs[0]).toMatchObject({ estimatedPercent: 6, tokens: 2000, costUsd: 3 });
    expect(account.jobsOmitted).toBe(1);
  });

  it("calibrates percent per USD from earlier windows and reports untracked usage", () => {
    // Earlier window: 20% for $4 of local usage => 5 percent per dollar.
    const earlierReset = T0 - 10 * H;
    const earlier = [
      { ...obs("claude:a", -14, 0, earlierReset) },
      { ...obs("claude:a", -12, 20, earlierReset) },
    ];
    const account = only({
      observations: [...earlier, obs("claude:a", 0.5, 0), obs("claude:a", 3, 30)],
      turns: [turn("claude:a", -13, "old", 4), turn("claude:a", 1, "now", 0.2)],
    });
    expect(account.calibration).toEqual({ basis: "costUsd", percentPerUnit: 5, intervals: 1 });
    // $0.20 is below the calibration threshold, so it explains 1 of the 30 points; the rest came from elsewhere.
    expect(percentOf(account, "now")).toBe(1);
    expect(account.explainedPercent).toBe(1);
    expect(account.untrackedPercent).toBe(29);
    expect(account.observedPercent).toBe(30);
  });

  it("never reports negative untracked usage when local cost exceeds the increase", () => {
    const account = only({
      observations: [obs("claude:a", 0.5, 0), obs("claude:a", 1.5, 10), obs("claude:a", 3, 11)],
      turns: [turn("claude:a", 1, "a", 2), turn("claude:a", 2, "b", 2)],
    });
    expect(account.untrackedPercent).toBeGreaterThanOrEqual(0);
    expect(account.explainedPercent).toBeLessThanOrEqual(account.observedPercent as number);
  });

  it("treats an interval without local turns as untracked", () => {
    const account = only({
      observations: [obs("claude:a", 1, 6), obs("claude:a", 2, 9)],
      turns: [turn("claude:a", 1.5, "s", 1)],
    });
    expect(account.untrackedPercent).toBe(6);
    expect(percentOf(account, "s")).toBe(3);
  });

  it("estimates the tail after the last observation with the calibration", () => {
    const earlierReset = T0 - 10 * H;
    const account = only({
      observations: [
        obs("claude:a", -14, 0, earlierReset),
        obs("claude:a", -12, 10, earlierReset),
        obs("claude:a", 1, 5),
      ],
      turns: [
        turn("claude:a", -13, "old", 1),
        turn("claude:a", 0.5, "x", 1),
        turn("claude:a", 2, "tail", 0.4),
      ],
    });
    expect(account.calibration.percentPerUnit).toBe(10);
    expect(account.unobservedTailPercent).toBe(4);
    expect(percentOf(account, "tail")).toBe(4);
  });

  it("leaves the tail and jobs unknown without a calibration", () => {
    const account = only({
      observations: [obs("claude:a", 1, 5)],
      turns: [turn("claude:a", 2, "tail", 1)],
    });
    expect(account.calibration.percentPerUnit).toBeNull();
    expect(account.unobservedTailPercent).toBeNull();
    expect(account.jobs[0]).toMatchObject({ estimatedPercent: null, partial: true });
  });

  it("reports unknown, not zero, when there are no observations", () => {
    const account = only({
      observations: [],
      turns: [turn("claude:a", 1, "s", 1)],
    });
    expect(account.status).toBe("noObservations");
    expect(account.observedPercent).toBeNull();
    expect(account.untrackedPercent).toBeNull();
    expect(account.jobs[0].estimatedPercent).toBeNull();
  });

  it("is stale once the observed window has reset", () => {
    const account = only({
      now: RESET + H,
      observations: [obs("claude:a", 4, 40)],
      turns: [turn("claude:a", 5.5, "after", 1)],
    });
    expect(account.status).toBe("stale");
    expect(account.observedPercent).toBeNull();
    expect(account.jobs.map((job) => job.sessionId)).toEqual(["after"]);
  });

  it("ignores usage and readings from before a reset when attributing the new window", () => {
    const newReset = RESET + 5 * H;
    const account = only({
      now: RESET + 2 * H,
      observations: [obs("claude:a", 4, 90), obs("claude:a", 6, 4, newReset)],
      turns: [turn("claude:a", 3, "old", 5), turn("claude:a", 5.5, "new", 1)],
    });
    expect(account.observedPercent).toBe(4);
    expect(account.jobs.map((job) => job.sessionId)).toEqual(["new"]);
    expect(percentOf(account, "new")).toBe(4);
  });

  it("does not learn from an interval that crossed a reset", () => {
    const account = only({
      observations: [obs("claude:a", 4, 90), obs("claude:a", 6, 4, RESET + 5 * H)],
      turns: [turn("claude:a", 5, "s", 10)],
      now: T0 + 6.5 * H,
    });
    expect(account.calibration).toEqual({ basis: "costUsd", percentPerUnit: null, intervals: 0 });
  });

  it("falls back to tokens when any turn has no price, without mixing units", () => {
    const account = only({
      observations: [obs("claude:a", 2, 10)],
      turns: [
        turn("claude:a", 0.5, "priced", 100, 3000),
        turn("claude:a", 1, "unpriced", null, 1000),
      ],
    });
    expect(account.calibration.basis).toBe("tokens");
    expect(percentOf(account, "priced")).toBe(7.5);
    expect(percentOf(account, "unpriced")).toBe(2.5);
    expect(account.jobs.find((job) => job.sessionId === "unpriced")?.costUsd).toBeNull();
  });

  it("never pools accounts", () => {
    const accounts = run({
      observations: [obs("claude:a", 2, 10), obs("codex:b", 2, 40)],
      turns: [turn("claude:a", 1, "shared-id", 1), turn("codex:b", 1, "shared-id", 1)],
    });
    expect(accounts.map((account) => account.account)).toEqual(["claude:a", "codex:b"]);
    expect(percentOf(accounts[0], "shared-id")).toBe(10);
    expect(percentOf(accounts[1], "shared-id")).toBe(40);
  });

  it("filters accounts and jobs without changing the attribution", () => {
    const base = {
      observations: [obs("claude:a", 2, 10), obs("codex:b", 2, 40)],
      turns: [
        turn("claude:a", 1, "s1", 3),
        turn("claude:a", 1.5, "s2", 1),
        turn("codex:b", 1, "s3", 1),
      ],
    };
    const accounts = run({ ...base, accounts: ["claude:a"], sessionIds: ["s2"] });
    expect(accounts).toHaveLength(1);
    expect(accounts[0].jobs.map((job) => job.sessionId)).toEqual(["s2"]);
    expect(accounts[0].jobs[0].estimatedPercent).toBe(2.5);
    const byTask = run({
      ...base,
      accounts: ["claude:a"],
      taskIds: ["t1"],
      turns: [{ ...base.turns[0], taskId: "t1" }, base.turns[1]],
    });
    expect(byTask[0].jobs.map((job) => job.sessionId)).toEqual(["s1"]);
  });

  it("ignores turns after now", () => {
    const account = only({
      observations: [obs("claude:a", 2, 10)],
      turns: [turn("claude:a", 1, "s", 1), turn("claude:a", 4.5, "future", 1)],
    });
    expect(account.jobs.map((job) => job.sessionId)).toEqual(["s"]);
  });
});
