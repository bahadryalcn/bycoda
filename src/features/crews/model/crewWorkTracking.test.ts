import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrewRunView } from "./crewClient";
import {
  assignableMembers,
  noteMembers,
  ownerRequestId,
  planAssignment,
  planNote,
  retryableTasks,
  settleOwnerRequest,
} from "./crewOwnerActions";
import { crewRunTimeline } from "./crewTimeline";
import { crewRunElapsedMs, crewRunSummary, crewRunUsage } from "./crewUsage";

vi.mock("../../connections/public/connections", () => ({ remoteRequest: vi.fn() }));

type Task = CrewRunView["tasks"][number];
const task = (overrides: Record<string, unknown>) =>
  ({
    id: "t",
    title: "Task",
    status: "running",
    createdAt: 10,
    updatedAt: 10,
    ...overrides,
  }) as Task;
const agent = (id: string, role: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  role,
  ...extra,
});
function run(overrides: Partial<CrewRunView> = {}): CrewRunView {
  return {
    id: "run",
    status: "active",
    createdAt: 1,
    updatedAt: 100,
    coordinatorSessionId: "lead-s",
    definition: {
      agents: [
        agent("lead", "coordinator"),
        agent("rev", "reviewer"),
        agent("dev", "specialist", { handle: "dev" }),
        agent("adv", "advisor"),
      ],
    },
    assignments: [{ taskId: "t1", memberId: "dev" }],
    messages: [],
    tasks: [],
    ...overrides,
  } as unknown as CrewRunView;
}

describe("crewRunTimeline", () => {
  it("orders task, review and message events from run data", () => {
    const events = crewRunTimeline(
      run({
        messages: [
          { id: "m", from: "lead-s", text: "Which API?", createdAt: 30, resolvedAt: 60 },
          { id: "o", from: "owner", text: "Go", createdAt: 5 },
        ] as never,
        tasks: [
          task({
            id: "t1",
            createdAt: 10,
            startedAt: 20,
            completedAt: 80,
            status: "done",
            attemptHistory: [
              { attempt: 1, at: 40, verdict: "fail" },
              { attempt: 2, at: 70, verdict: "pass" },
            ],
          }),
        ],
      }),
    );
    expect(events.map((e) => [e.at, e.kind])).toEqual([
      [1, "created"],
      [5, "request"],
      [10, "assigned"],
      [20, "started"],
      [30, "request"],
      [40, "review-failed"],
      [60, "resolved"],
      [70, "review-passed"],
      [80, "accepted"],
    ]);
    expect(events.find((e) => e.kind === "assigned")?.memberId).toBe("dev");
    expect(events.find((e) => e.kind === "review-failed")?.memberId).toBe("rev");
    expect(events.find((e) => e.id === "request:m")?.memberId).toBe("lead");
    expect(events.find((e) => e.id === "request:o")?.memberId).toBeUndefined();
  });

  it("marks underived moments approximate and adds blocked, paused and finished", () => {
    const events = crewRunTimeline(
      run({
        status: "finished",
        tasks: [
          task({ id: "t1", status: "blocked", updatedAt: 50 }),
          task({ id: "t2", status: "review", updatedAt: 60 }),
          task({ id: "t3", status: "done", updatedAt: 70 }),
        ],
      }),
    );
    expect(events.filter((e) => e.approximate).map((e) => e.kind)).toEqual([
      "blocked",
      "review",
      "accepted",
      "finished",
    ]);
    expect(events.at(-1)).toMatchObject({ kind: "finished", at: 100 });
    expect(crewRunTimeline(run({ status: "paused" })).at(-1)?.kind).toBe("paused");
  });

  it("keeps same-time events in story order", () => {
    const events = crewRunTimeline(
      run({ tasks: [task({ id: "t1", createdAt: 1, startedAt: 1 })] }),
    );
    expect(events.map((e) => e.kind)).toEqual(["created", "assigned", "started"]);
  });
});

const budget = (overrides: Record<string, unknown>) => ({
  attempts: 1,
  agentMinutes: 2,
  reportedTokens: 100,
  tokens: 100,
  reportedCostUsd: 0.5,
  ...overrides,
});

describe("crewRunUsage", () => {
  const tasks = [
    task({ id: "t1", budgetUsage: budget({}) }),
    task({
      id: "t2",
      startedAt: 1000,
      completedAt: 4000,
      budgetUsage: budget({ attempts: 0, tokens: null, reportedTokens: 40, reportedCostUsd: null }),
    }),
    task({ id: "t3" }),
  ];
  const assignments = [
    { taskId: "t1", memberId: "dev" },
    { taskId: "t2", memberId: "dev" },
    { taskId: "t3", memberId: "adv" },
  ];

  it("reads per-task duration, tokens and cost, with timestamp fallback", () => {
    const usage = crewRunUsage(run({ tasks, assignments } as never));
    expect(usage.perTask.t1).toEqual({
      durationMs: 120_000,
      tokens: 100,
      tokensExact: true,
      costUsd: 0.5,
    });
    expect(usage.perTask.t2).toMatchObject({ durationMs: 3000, tokens: 40, tokensExact: false });
    expect(usage.perTask.t2.costUsd).toBeUndefined();
    expect(usage.perTask.t3.durationMs).toBeUndefined();
  });

  it("sums per member and total, flagging lower bounds", () => {
    const usage = crewRunUsage(run({ tasks, assignments } as never));
    expect(usage.perMember.dev).toMatchObject({ tasks: 2, durationMs: 123_000, tokens: 140 });
    expect(usage.perMember.dev.tokensExact).toBe(false);
    expect(usage.perMember.adv.tokens).toBeUndefined();
    expect(usage.total).toMatchObject({ durationMs: 123_000, tokens: 140, costUsd: 0.5 });
  });

  it("measures elapsed to the last update only once finished", () => {
    expect(crewRunElapsedMs(run(), 500)).toBe(499);
    expect(crewRunElapsedMs(run({ status: "finished" }), 500)).toBe(99);
  });
});

describe("crewRunSummary", () => {
  it("lists accepted work and who did it, and what is still open", () => {
    const summary = crewRunSummary(
      run({
        assignments: [
          { taskId: "a", memberId: "dev" },
          { taskId: "b", memberId: "adv" },
          { taskId: "c", memberId: "dev" },
        ],
        tasks: [
          task({ id: "b", title: "B", status: "done", completedAt: 20 }),
          task({ id: "a", title: "A", status: "done", completedAt: 30 }),
          task({ id: "c", title: "C", status: "blocked" }),
        ],
      } as never),
    );
    expect(summary.done.map((d) => d.title)).toEqual(["B", "A"]);
    expect(summary.memberIds).toEqual(["adv", "dev"]);
    expect(summary.open).toEqual([{ taskId: "c", title: "C", status: "blocked", memberId: "dev" }]);
  });
});

describe("owner action payloads", () => {
  it("assigns only to specialists and advisors of an active work", () => {
    expect(assignableMembers(run()).map((a) => a.id)).toEqual(["dev", "adv"]);
    expect(assignableMembers(run({ status: "paused" }))).toEqual([]);
    const input = { memberId: "dev", title: " Fix ", prompt: " Do it ", requestId: "r1" };
    expect(planAssignment(run(), input)).toEqual({
      ok: true,
      params: { runId: "run", requestId: "r1", memberId: "dev", title: "Fix", prompt: "Do it" },
    });
    expect(planAssignment(run(), { ...input, memberId: "lead" }).ok).toBe(false);
    expect(planAssignment(run(), { ...input, title: " " }).ok).toBe(false);
    expect(planAssignment(run(), { ...input, prompt: "" }).ok).toBe(false);
  });

  it("sends a note to the coordinator that names the member", () => {
    const plan = planNote(run(), { memberId: "dev", note: " Use tokens ", requestId: "r2" });
    expect(plan.ok && plan.params).toMatchObject({ runId: "run", requestId: "r2" });
    expect(plan.ok && plan.params.text).toContain("dev (@dev), id dev");
    expect(plan.ok && plan.params.text).toContain("Use tokens");
    expect(planNote(run(), { memberId: "nobody", note: "x", requestId: "r" }).ok).toBe(false);
    expect(
      planNote(run({ status: "finished" }), { memberId: "dev", note: "x", requestId: "r" }).ok,
    ).toBe(false);
    expect(noteMembers(run())).toHaveLength(4);
  });

  it("offers retry only for blocked tasks of unfinished work", () => {
    const tasks = [task({ id: "a", status: "blocked" }), task({ id: "b", status: "done" })];
    expect(retryableTasks(run({ tasks })).map((t) => t.id)).toEqual(["a"]);
    expect(retryableTasks(run({ tasks, status: "finished" }))).toEqual([]);
  });
});

describe("ownerRequestId", () => {
  beforeEach(() => settleOwnerRequest("k"));
  it("keeps one id per action until settled", () => {
    const first = ownerRequestId("k");
    expect(ownerRequestId("k")).toBe(first);
    settleOwnerRequest("k");
    expect(ownerRequestId("k")).not.toBe(first);
  });
});
