import { describe, expect, it } from "vitest";
import type { CrewDefinition, SavedCrewAgent } from "../../crews/public/mentions";
import {
  crewMentionTargets,
  delegationNote,
  delegationRequestId,
  delegationRequestKey,
  findCrewMentions,
  mentionSlug,
  rankCrewMentions,
  type CrewMentionSource,
} from "./crewMentions";

function agent(id: string, name: string, handle?: string, role = "specialist"): SavedCrewAgent {
  return {
    id,
    name,
    role,
    instructions: "",
    selection: "automatic",
    candidates: [],
    handle,
    updatedAt: 1,
  } as unknown as SavedCrewAgent;
}

function crew(id: string, name: string, members: SavedCrewAgent[]): CrewDefinition {
  return { id, name, agents: members, updatedAt: 1 } as unknown as CrewDefinition;
}

const dba = agent("m1", "Database Admin", "dba");
const ui = agent("m2", "UI Designer", "pixel");
const plain = agent("m3", "Release Manager");
const source = (over: Partial<CrewMentionSource> = {}): CrewMentionSource => ({
  machineId: "host",
  projectId: "p",
  agents: [dba, ui, plain],
  definitions: [crew("c1", "Data Team", [dba]), crew("c2", "Empty", [])],
  memberAsk: true,
  ...over,
});

describe("rankCrewMentions", () => {
  it("ranks a handle prefix before a name match", () => {
    const rows = rankCrewMentions(
      source({
        agents: [agent("a", "Data Wizard", "wiz"), agent("b", "Other", "data")],
        definitions: [],
      }),
      "da",
    );
    expect(rows.map((row) => row.relative)).toEqual(["data", "wiz"]);
  });

  it("lists members before crews and uses reserved paths", () => {
    const rows = rankCrewMentions(source(), "da");
    expect(rows.map((row) => row.path)).toEqual(["crew-member/m1", "crew/c1"]);
    expect(rows[0]!.relative).toBe("dba");
    expect(rows[1]!.relative).toBe("data-team");
  });

  it("matches words and substrings of names, not unrelated rows", () => {
    expect(rankCrewMentions(source(), "admin").map((row) => row.relative)).toEqual(["dba"]);
    expect(rankCrewMentions(source(), "zzz")).toEqual([]);
  });

  it("shows everything for an empty query except crews without members", () => {
    const rows = rankCrewMentions(source(), "");
    expect(rows.map((row) => row.relative)).toEqual([
      "dba",
      "release-manager",
      "pixel",
      "data-team",
    ]);
  });

  it("omits members when the Host cannot ask them", () => {
    const rows = rankCrewMentions(source({ memberAsk: false }), "");
    expect(rows.map((row) => row.relative)).toEqual(["data-team"]);
  });

  it("gives a member without a handle a slug token and skips taken tokens", () => {
    expect(mentionSlug("Release Manager")).toBe("release-manager");
    expect(mentionSlug("日本語")).toBeUndefined();
    const targets = crewMentionTargets(
      source({ agents: [agent("a", "Zed", "zed"), agent("b", "Zed")] }),
    );
    expect(targets.filter((target) => target.token === "zed")).toHaveLength(1);
  });
});

describe("findCrewMentions", () => {
  const targets = crewMentionTargets(source());
  const tokens = (text: string) => findCrewMentions(text, targets).map((target) => target.token);

  it("resolves handles and crew tokens once each, in order", () => {
    expect(tokens("ask @dba and @data-team, then @dba again")).toEqual(["dba", "data-team"]);
    expect(tokens("@pixel.")).toEqual(["pixel"]);
    expect(tokens("(@pixel) ok")).toEqual([]);
  });

  it("ignores unknown tokens, emails and code", () => {
    expect(tokens("@nobody please")).toEqual([]);
    expect(tokens("mail me at a@dba now")).toEqual([]);
    expect(tokens("foo@dba.com")).toEqual([]);
    expect(tokens("use `@dba` here")).toEqual([]);
    expect(tokens("```\n@dba\n```")).toEqual([]);
    expect(tokens("> @dba said so")).toEqual([]);
    expect(tokens("@dba.com is a host")).toEqual([]);
  });

  it("does not resolve a prefix of a longer token", () => {
    expect(tokens("@db or @dba2")).toEqual([]);
  });
});

describe("delegation identity", () => {
  it("is stable for one send and differs per turn, queued row and target", () => {
    const base = { sessionId: "s", userTurns: 2 };
    const key = delegationRequestKey(base);
    expect(delegationRequestKey({ ...base })).toBe(key);
    expect(delegationRequestKey({ ...base, userTurns: 3 })).not.toBe(key);
    expect(delegationRequestKey({ ...base, queuedMessageId: "q1" })).toBe("s:q1");
    expect(delegationRequestKey({ ...base, queuedMessageId: "q1", userTurns: 9 })).toBe("s:q1");
    expect(delegationRequestId(key, { kind: "member", id: "m1" })).toBe(
      delegationRequestId(key, { kind: "member", id: "m1" }),
    );
    expect(delegationRequestId(key, { kind: "member", id: "m1" })).not.toBe(
      delegationRequestId(key, { kind: "crew", id: "m1" }),
    );
  });

  it("writes one note per delegation", () => {
    expect(delegationNote({ kind: "member", token: "dba" }, "t1")).toBe(
      "Delegated to @dba (task t1); results will appear here.",
    );
    expect(delegationNote({ kind: "crew", token: "data-team" }, undefined)).toBe(
      "Delegated to @data-team; results will appear here.",
    );
  });
});
