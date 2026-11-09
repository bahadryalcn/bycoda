import { describe, expect, it } from "vitest";
import type { HostSessionSummary } from "../../src/features/connections/model/protocol";
import { newSession } from "../../src/features/sessions/model/session";
import { hostTurnWait, withSessionWaits } from "./session-waits";

const row = (patch: Partial<HostSessionSummary> & { id: string }): HostSessionSummary => ({
  projectId: "p",
  revision: 1,
  status: "idle",
  updatedAt: 1,
  title: patch.id,
  harness: "claude",
  ...patch,
});
const child = (id: string, parentSessionId: string, startedAt: number, running: boolean) =>
  row({
    id,
    status: running ? "running" : "idle",
    delegationParent: {
      parentSessionId,
      runId: `run-${id}`,
      kind: "subagent",
      model: "codex:gpt-a",
      startedAt,
    },
  });

describe("hostTurnWait", () => {
  const session = { ...newSession("claude", "/repo"), blocks: [] };

  it("reports background work only for a running turn the agent yielded", () => {
    const background = { ...session, backgroundTasks: ["tests"], backgroundAgents: 0 };
    expect(
      hostTurnWait({ status: "running", session: { ...background, backgroundSince: 7 } }),
    ).toEqual({ waiting: { kind: "commands", count: 1, since: 7 } });
    expect(hostTurnWait({ status: "running", session })).toEqual({});
    expect(hostTurnWait({ status: "idle", session: background })).toEqual({});
  });
});

describe("withSessionWaits", () => {
  it("waits idle parents on running delegated children and stamps wake sources", () => {
    const watch = { kind: "pull-request" as const, label: "acme/app#1", since: 3 };
    const plain = row({ id: "plain" });
    const rows = withSessionWaits(
      [
        row({ id: "parent" }),
        child("c1", "parent", 20, true),
        child("c2", "parent", 10, true),
        child("c3", "parent", 5, false),
        row({ id: "watched" }),
        row({ id: "busy", status: "running" }),
        child("c4", "busy", 1, true),
        plain,
      ],
      new Map([["watched", [watch]]]),
    );
    const byId = new Map(rows.map((entry) => [entry.id, entry]));
    expect(byId.get("parent")?.waiting).toEqual({ kind: "delegated", count: 2, since: 10 });
    expect(byId.get("watched")).toMatchObject({ wakeSources: [watch] });
    expect(byId.get("watched")?.waiting).toBeUndefined();
    expect(byId.get("busy")?.waiting).toBeUndefined();
    expect(byId.get("plain")).toBe(plain);
  });

  it("carries no wake source once the watch is gone", () => {
    const [listed] = withSessionWaits([row({ id: "watched" })], new Map());
    expect(listed.wakeSources).toBeUndefined();
  });
});
