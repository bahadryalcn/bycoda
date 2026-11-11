import { describe, expect, it } from "vitest";
import {
  DELEGATION_PARENT_KEY,
  type DelegationParent,
} from "../../../shared/model/host-contracts/delegation";
import { newSession, type Session } from "./session";
import {
  sessionWait,
  sessionWaitReason,
  sessionWaitReasonWith,
  sessionWaitsEqual,
} from "./sessionWait";
import { applyBackgroundUpdate } from "../../../integrations/harness/core/backgroundWait";
import { stopStreaming } from "../../../integrations/harness/core/apply";

function session(patch: Partial<Session> = {}): Session {
  return { ...newSession("claude", "/repo"), id: "parent", blocks: [], ...patch };
}

function child(id: string, startedAt: number, patch: Partial<Session> = {}): Session {
  const link: DelegationParent = {
    parentSessionId: "parent",
    runId: `run-${id}`,
    kind: "subagent",
    model: "codex:gpt-a",
    startedAt,
  };
  return session({
    id,
    modelSettings: { [DELEGATION_PARENT_KEY]: JSON.stringify(link) },
    ...patch,
  });
}

describe("sessionWait", () => {
  it("is null while the agent itself works or nothing is pending", () => {
    expect(sessionWait(session({ busy: true }))).toBeNull();
    expect(sessionWait(session())).toBeNull();
    expect(
      sessionWait(session({ continuingElsewhere: true }), [child("c", 1, { busy: true })]),
    ).toBeNull();
  });

  it("names background commands, subagents, or mixed work while the turn is held open", () => {
    const base = { busy: true, backgroundTasks: ["dev server", "tests"], backgroundSince: 5 };
    expect(sessionWait(session({ ...base, backgroundAgents: 0 }))).toEqual({
      kind: "commands",
      count: 2,
      since: 5,
    });
    expect(sessionWait(session({ ...base, backgroundAgents: 1 }))?.kind).toBe("agents");
    expect(sessionWait(session(base))?.kind).toBe("tasks");
  });

  it("waits on running delegated children after the parent turn ended, from the earliest start", () => {
    const children = [
      child("a", 3_000, { busy: true }),
      child("b", 2_000, { continuingElsewhere: true }),
      child("c", 1_000),
    ];
    expect(sessionWait(session(), children)).toEqual({ kind: "delegated", count: 2, since: 2_000 });
  });

  it("yields to needs-input", () => {
    const pending = session({
      busy: true,
      backgroundTasks: ["tests"],
      backgroundAgents: 0,
      blocks: [
        { id: "a", role: "tool", text: "Run", approval: { id: "x", decided: false } } as never,
      ],
    });
    expect(sessionWait(pending)).toBeNull();
  });

  it("describes the reason and compares by value", () => {
    expect(sessionWaitReason({ kind: "delegated", count: 2 })).toContain("2");
    const tagged = ((key: string) => `x:${key}`) as unknown as Parameters<
      typeof sessionWaitReasonWith
    >[0];
    expect(sessionWaitReasonWith(tagged, { kind: "agents", count: 1 })).toBe(
      "x:Waiting on subagents: {p0}",
    );
    expect(sessionWaitsEqual({ kind: "agents", count: 1 }, { kind: "agents", count: 1 })).toBe(
      true,
    );
    expect(sessionWaitsEqual({ kind: "agents", count: 1 }, null)).toBe(false);
  });
});

describe("Host wake sources", () => {
  const pr = (label: string, since?: number, until?: number) => ({
    kind: "pull-request" as const,
    label,
    since,
    until,
  });

  it("waits an idle session on its pull request watches, from the earliest watch", () => {
    expect(
      sessionWait(session(), [], { wakeSources: [pr("acme/app#2", 20), pr("acme/app#1", 10)] }, 50),
    ).toEqual({ kind: "pull-request", count: 2, since: 10, label: "acme/app#2, acme/app#1" });
  });

  it("drops a source once its until has passed, and an empty list waits on nothing", () => {
    const host = { wakeSources: [pr("acme/app#1", 10, 100)] };
    expect(sessionWait(session(), [], host, 99)?.kind).toBe("pull-request");
    expect(sessionWait(session(), [], host, 100)).toBeNull();
    expect(sessionWait(session(), [], { wakeSources: [] }, 0)).toBeNull();
  });

  it("keeps working, needs-input and delegated children ahead of wake sources", () => {
    const host = { wakeSources: [pr("acme/app#1", 10)] };
    expect(sessionWait(session({ busy: true }), [], host, 50)).toBeNull();
    expect(sessionWait(session({ continuingElsewhere: true }), [], host, 50)).toBeNull();
    expect(sessionWait(session(), [child("c", 5, { busy: true })], host, 50)?.kind).toBe(
      "delegated",
    );
    const asking = session({
      blocks: [
        { id: "a", role: "tool", text: "Run", approval: { id: "x", decided: false } } as never,
      ],
    });
    expect(sessionWait(asking, [], host, 50)).toBeNull();
  });

  it("takes a Host-run turn's own wait while the Host continues it", () => {
    const waiting = { kind: "commands" as const, count: 1, since: 5 };
    expect(sessionWait(session({ continuingElsewhere: true }), [], { waiting })).toEqual(waiting);
  });

  it("names the pull request in the reason and compares labels", () => {
    expect(sessionWaitReason({ kind: "pull-request", count: 1, label: "acme/app#7" })).toContain(
      "acme/app#7",
    );
    expect(
      sessionWaitsEqual(
        { kind: "pull-request", count: 1, label: "a#1" },
        { kind: "pull-request", count: 1, label: "a#2" },
      ),
    ).toBe(false);
  });
});

describe("background wait clock", () => {
  it("starts on the first background update, keeps it across updates, and clears with the turn", () => {
    const first = applyBackgroundUpdate(session({ busy: true }), { tasks: ["a"], agents: 0 }, 100);
    expect(first.backgroundSince).toBe(100);
    const next = applyBackgroundUpdate(first, { tasks: ["a", "b"], agents: 0 }, 200);
    expect(next.backgroundSince).toBe(100);
    const cleared = applyBackgroundUpdate(next, { tasks: [] }, 300);
    expect(cleared.backgroundSince).toBeUndefined();
    expect(cleared.backgroundTasks).toBeUndefined();
    expect(stopStreaming(next).backgroundSince).toBeUndefined();
  });
});
