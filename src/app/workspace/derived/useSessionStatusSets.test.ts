import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostSessionSummary } from "../../../features/connections/model/protocol";
import {
  DELEGATION_PARENT_KEY,
  type DelegationParent,
} from "../../../shared/model/host-contracts/delegation";
import { newSession, type Session } from "../../../features/sessions/model/session";
import { computeSessionWaits } from "./useSessionStatusSets";

function session(id: string, patch: Partial<Session> = {}): Session {
  return { ...newSession("claude", "/repo"), id, blocks: [], ...patch };
}

function child(
  id: string,
  parentSessionId: string,
  startedAt: number,
  patch: Partial<Session> = {},
) {
  const link: DelegationParent = {
    parentSessionId,
    runId: `run-${id}`,
    kind: "subagent",
    model: "codex:gpt-a",
    startedAt,
  };
  return session(id, {
    modelSettings: { [DELEGATION_PARENT_KEY]: JSON.stringify(link) },
    ...patch,
  });
}

describe("computeSessionWaits", () => {
  it("waits idle parents on their own running children only", () => {
    const waits = computeSessionWaits([
      session("p1"),
      session("p2"),
      session("p3"),
      child("c1", "p1", 10, { busy: true }),
      child("c2", "p1", 5, { busy: true }),
      child("c3", "p2", 7),
    ]);
    expect(waits.get("p1")).toEqual({ kind: "delegated", count: 2, since: 5 });
    expect(waits.has("p2")).toBe(false);
    expect(waits.has("p3")).toBe(false);
    expect(waits.has("c1")).toBe(false);
  });

  it("waits busy sessions on background work and leaves plain busy sessions working", () => {
    const waits = computeSessionWaits([
      session("bg", {
        busy: true,
        backgroundTasks: ["server"],
        backgroundAgents: 0,
      }),
      session("plain", { busy: true }),
    ]);
    expect(waits.get("bg")?.kind).toBe("commands");
    expect(waits.has("plain")).toBe(false);
  });
});

describe("computeSessionWaits with listed host sessions", () => {
  afterEach(() => vi.unstubAllGlobals());
  const project = "remote://env/repo";
  const row = (patch: Partial<HostSessionSummary> & { id: string }) => ({
    project,
    session: {
      projectId: "p",
      revision: 1,
      status: "idle" as const,
      updatedAt: 1,
      title: patch.id,
      harness: "claude" as const,
      ...patch,
    },
  });
  const watch = (until?: number) => [
    { kind: "pull-request" as const, label: "acme/app#9", since: 10, until },
  ];

  it("keys host rows by host id and gives a bound local tab the Host wake sources", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify({ shell: "host-1" }),
    });
    const waits = computeSessionWaits(
      [session("shell"), session("local")],
      [row({ id: "host-1", wakeSources: watch() }), row({ id: "host-2" })],
      50,
    );
    expect(waits.get("host-1")).toMatchObject({ kind: "pull-request", label: "acme/app#9" });
    expect(waits.get("shell")).toMatchObject({ kind: "pull-request", since: 10 });
    expect(waits.has("local")).toBe(false);
    expect(waits.has("host-2")).toBe(false);
  });

  it("clears Waiting when the watch ends or its until passes", () => {
    expect(computeSessionWaits([], [row({ id: "h", wakeSources: watch(100) })], 99).has("h")).toBe(
      true,
    );
    expect(computeSessionWaits([], [row({ id: "h", wakeSources: watch(100) })], 100).has("h")).toBe(
      false,
    );
    expect(computeSessionWaits([], [row({ id: "h" })], 0).has("h")).toBe(false);
  });
});
