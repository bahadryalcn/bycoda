import { describe, expect, it } from "vitest";
import { CREW_LIST_MESSAGE_LIMIT } from "./crew";
import type { CrewRunView } from "./crewClient";
import {
  crewActivityKnown,
  crewAttentionLabel,
  crewCanStop,
  crewExecutionLabel,
  crewExecutionState,
  crewHasRunningWork,
  crewMessageMayBeClipped,
  crewOpenAttention,
  nextCrewManagedSessions,
  crewRequestInfo,
  crewReviewLabel,
  crewRunAttention,
  crewRunMatchesQuery,
  crewRunMember,
  crewRunRoleMember,
  crewSavedTeamChanged,
  crewTaskReview,
  crewWorkStatus,
} from "./crewPresentation";

function run(overrides: Partial<CrewRunView> = {}): CrewRunView {
  return {
    status: "paused",
    coordinatorStatus: "idle",
    tasks: [],
    messages: [],
    assignments: [],
    definition: { id: "crew", name: "Website Crew", agents: [], updatedAt: 10 },
    ...overrides,
  } as unknown as CrewRunView;
}

const open = { id: "m1", from: "lead", text: "Which API version?", createdAt: 1 };
const task = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "t1",
    title: "Build settings",
    status: "running",
    ...overrides,
  }) as unknown as CrewRunView["tasks"][number];

describe("crew work controls", () => {
  it("does not interpret missing activity from an older host as a completed stop", () => {
    const legacy = run({ coordinatorSessionId: "lead", coordinatorStatus: undefined });
    expect(crewActivityKnown(legacy)).toBe(false);
    expect(crewCanStop(legacy)).toBe(true);
  });
  it("does not offer another stop for paused, idle planning work", () => {
    expect(crewCanStop(run())).toBe(false);
    expect(crewHasRunningWork(run())).toBe(false);
    expect(crewWorkStatus(run())).toBe("paused");
  });

  it("keeps stop available after pausing assignments while the coordinator runs", () => {
    const paused = run({ coordinatorStatus: "running" });
    expect(crewCanStop(paused)).toBe(true);
    expect(crewHasRunningWork(paused)).toBe(true);
    expect(crewWorkStatus(paused)).toBe("paused");
  });

  it.each(["queued", "running", "verifying"] as const)(
    "can stop a paused %s assignment",
    (status) => {
      const paused = run({ tasks: [task({ status })] });
      expect(crewCanStop(paused)).toBe(true);
      expect(crewHasRunningWork(paused)).toBe(status !== "queued");
    },
  );

  it("can pause active scheduling even while no conversation is running", () => {
    expect(crewCanStop(run({ status: "active" }))).toBe(true);
  });

  it("keeps finished work immutable", () => {
    expect(crewCanStop(run({ status: "finished" }))).toBe(false);
  });
});

describe("execution state and attention are separate (CR-W04)", () => {
  it("keeps a paused run paused while a decision, review or blocker waits", () => {
    const decision = run({ messages: [open] });
    expect(crewExecutionState(decision)).toBe("paused");
    expect(crewRunAttention(decision)).toBe("decision");
    expect(crewExecutionLabel("paused")).toBe("Paused");
    expect(crewAttentionLabel("decision")).toBe("Needs decision");
    expect(crewRunAttention(run({ tasks: [task({ status: "review" })] }))).toBe("review");
    expect(crewRunAttention(run({ tasks: [task({ status: "blocked" })] }))).toBe("blocked");
  });

  it("ranks a decision before a review and a review before a blocker", () => {
    expect(
      crewRunAttention(
        run({
          messages: [open],
          tasks: [task({ status: "review" }), task({ id: "t2", status: "blocked" })],
        }),
      ),
    ).toBe("decision");
    expect(
      crewRunAttention(
        run({ tasks: [task({ status: "blocked" }), task({ id: "t2", status: "review" })] }),
      ),
    ).toBe("review");
  });

  it("ignores resolved decisions and reports no attention for idle work", () => {
    expect(crewRunAttention(run({ messages: [{ ...open, resolvedAt: 2 }] }))).toBeNull();
    expect(crewRunAttention(run())).toBeNull();
  });

  it("derives execution from the run and its activity, not from attention", () => {
    expect(crewExecutionState(run({ status: "finished" }))).toBe("finished");
    expect(crewExecutionState(run({ status: "active" }))).toBe("active");
    expect(crewExecutionState(run({ status: "active", coordinatorStatus: "running" }))).toBe(
      "working",
    );
    expect(crewExecutionState(run({ status: "active", messages: [open] }))).toBe("active");
    expect(crewExecutionLabel("finished")).toBe("Done");
  });

  it("reports no attention for finished work", () => {
    expect(crewOpenAttention(run({ status: "finished", messages: [open] }))).toBeNull();
    expect(crewOpenAttention(run({ messages: [open] }))).toBe("decision");
  });

  it("keeps the combined rail status compatible", () => {
    expect(crewWorkStatus(run({ messages: [open] }))).toBe("paused");
    expect(crewWorkStatus(run({ status: "active", messages: [open] }))).toBe("input");
    expect(crewWorkStatus(run({ status: "active", tasks: [task({ status: "blocked" })] }))).toBe(
      "blocked",
    );
    expect(crewWorkStatus(run({ status: "active", coordinatorStatus: "running" }))).toBe("working");
  });
});

describe("request completeness (CR-W01)", () => {
  it("shows a full request only when the response carries it", () => {
    const launch = { prompt: "  Build the settings page\nwith tests  " } as CrewRunView["launch"];
    expect(crewRequestInfo({ launch, title: "Build the settings page" })).toEqual({
      kind: "full",
      text: "Build the settings page\nwith tests",
    });
  });

  it("names the list title as the request's first line when the Host strips launch", () => {
    expect(crewRequestInfo({ launch: undefined, title: "Build the settings page" })).toEqual({
      kind: "first-line",
      text: "Build the settings page",
    });
  });

  it("is honestly unavailable without a launch or a title", () => {
    expect(crewRequestInfo({ launch: undefined, title: undefined })).toEqual({
      kind: "unavailable",
    });
    expect(crewRequestInfo({ launch: undefined, title: "  " })).toEqual({ kind: "unavailable" });
  });

  it("flags only messages that reach the list clip limit", () => {
    expect(crewMessageMayBeClipped("x".repeat(CREW_LIST_MESSAGE_LIMIT - 1))).toBe(false);
    expect(crewMessageMayBeClipped("x".repeat(CREW_LIST_MESSAGE_LIMIT))).toBe(true);
  });
});

describe("run team snapshot (CR-W02/W05)", () => {
  const agents = [
    { id: "lead", name: "Lead", role: "coordinator" },
    { id: "ui", name: "UI engineer", role: "specialist" },
    { id: "qa", name: "QA", role: "reviewer" },
  ];
  const snapshot = run({
    definition: { id: "crew", name: "Crew", agents, updatedAt: 10 } as never,
  });

  it("reads members and roles from the run, never from the saved crew", () => {
    expect(crewRunMember(snapshot, "ui")?.name).toBe("UI engineer");
    expect(crewRunMember(snapshot, "gone")).toBeUndefined();
    expect(crewRunMember(snapshot, undefined)).toBeUndefined();
    expect(crewRunRoleMember(snapshot, "reviewer")?.name).toBe("QA");
    expect(crewRunRoleMember(snapshot, "advisor")).toBeUndefined();
  });

  it("notices a saved crew edited after the work started", () => {
    expect(crewSavedTeamChanged(snapshot, { updatedAt: 11 })).toBe(true);
    expect(crewSavedTeamChanged(snapshot, { updatedAt: 10 })).toBe(false);
    expect(crewSavedTeamChanged(snapshot, undefined)).toBe(false);
  });
});

describe("current and earlier reviews (CR-W05)", () => {
  it("treats the published reviewer session of a verifying task as the current review", () => {
    const verifying = task({
      status: "verifying",
      reviewer: { sessionId: "now" },
      verification: { review: { verdict: "pass", sessionId: "before" } },
    });
    expect(crewTaskReview(verifying, "now")).toEqual({ current: true, state: "reviewing" });
  });

  it("does not call the previous review current before the new reviewer publishes a session", () => {
    const verifying = task({
      status: "verifying",
      verification: { review: { verdict: "pass", sessionId: "before" } },
    });
    expect(crewTaskReview(verifying, "before")).toEqual({ current: false, state: "reviewing" });
  });

  it("labels finished reviews by verdict and unknown ones as earlier", () => {
    const pass = task({ status: "review", verification: { review: { verdict: "pass" } } });
    const fail = task({ status: "running", verification: { review: { verdict: "fail" } } });
    expect(crewTaskReview(pass, "r").state).toBe("passed");
    expect(crewTaskReview(fail, "r").state).toBe("changes");
    expect(crewTaskReview(task({ status: "running" }), "r")).toEqual({
      current: false,
      state: "previous",
    });
    expect(crewReviewLabel("previous")).toBe("Earlier review");
  });
});

describe("work search (CR-W03)", () => {
  const work = run({
    title: "Improve mobile navigation",
    status: "paused",
    definition: {
      id: "crew",
      name: "Website Crew",
      agents: [{ id: "a", name: "Iris", role: "specialist" }],
      updatedAt: 1,
    } as never,
    tasks: [task({ title: "Tab bar polish" })],
    messages: [open],
  });

  it("matches title, crew, task, member, status and open decision text", () => {
    for (const query of ["navigation", "website", "tab bar", "iris", "paused", "which api"])
      expect(crewRunMatchesQuery(work, query)).toBe(true);
    expect(crewRunMatchesQuery(work, "billing")).toBe(false);
  });

  it("matches everything for an empty query and ignores case and padding", () => {
    expect(crewRunMatchesQuery(work, "   ")).toBe(true);
    expect(crewRunMatchesQuery(work, " NAVIGATION ")).toBe(true);
  });

  it("does not search resolved decisions", () => {
    expect(crewRunMatchesQuery(run({ messages: [{ ...open, resolvedAt: 5 }] }), "which api")).toBe(
      false,
    );
  });
});

describe("nextCrewManagedSessions", () => {
  it("keeps the previous state when the unique ids are unchanged, even with a duplicate id", () => {
    const previous = { cwd: "/p", ids: new Set(["a", "b"]) };
    // A coordinator that is also a task session lists its id twice; this once looped the sidebar (React #185).
    expect(nextCrewManagedSessions(previous, "/p", ["a", "b", "a"])).toBe(previous);
    expect(nextCrewManagedSessions(previous, "/p", ["b", "a"])).toBe(previous);
  });

  it("returns a new state when the project or the ids change", () => {
    const previous = { cwd: "/p", ids: new Set(["a"]) };
    expect(nextCrewManagedSessions(previous, "/q", ["a"])).toEqual({
      cwd: "/q",
      ids: new Set(["a"]),
    });
    expect(nextCrewManagedSessions(previous, "/p", ["a", "c"]).ids).toEqual(new Set(["a", "c"]));
  });
});
