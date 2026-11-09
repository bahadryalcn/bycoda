import { describe, expect, it } from "vitest";
import { sessionDelegationParent } from "../../../shared/model/host-contracts/delegation";
import { newSession } from "./session";
import { liveSessionInfos } from "./recentSessions";
import { summaryFromSession } from "../data/sessionHistory";
import { buildGlobalRecentSessions } from "./globalRecentSessions";
import { pathKey } from "../../../shared/lib/paths";

const parent = {
  parentSessionId: "parent",
  runId: "run",
  kind: "subagent",
  model: "codex:m",
  startedAt: 1,
};
const child = () => ({
  ...newSession("codex", "/repo"),
  id: "child",
  title: "Renamed work",
  modelSettings: { delegationParent: JSON.stringify(parent) },
  blocks: [{ id: "u", role: "user" as const, text: "Work" }],
});

describe("delegation collection visibility", () => {
  it("uses validated lineage, never titles or stale summary metadata", () => {
    expect(sessionDelegationParent(child())).toEqual(parent);
    expect(sessionDelegationParent({ delegationParent: parent })).toEqual(parent);
    expect(sessionDelegationParent({ title: "Subagent · Haiku" })).toBeUndefined();
    expect(sessionDelegationParent({ modelSettings: { delegationParent: "{}" } })).toBeUndefined();
    expect(
      sessionDelegationParent({ modelSettings: {}, delegationParent: parent }),
    ).toBeUndefined();
  });

  it("keeps child live rows and stored history out of ordinary recent collections", () => {
    const run = child();
    const summary = summaryFromSession(run);
    expect(summary.delegationParent).toEqual(parent);
    expect(liveSessionInfos([run])).toEqual([]);
    expect(
      buildGlobalRecentSessions([summary], [], [run], new Set([pathKey("/repo")]), Date.now()),
    ).toEqual([]);
  });
});
