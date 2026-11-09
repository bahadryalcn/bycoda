import { describe, expect, it } from "vitest";
import {
  filterLibraryMembers,
  hiddenSelection,
  matchesMemberQuery,
  memberSearchHaystack,
  type MemberSearchLabels,
  type MemberSearchSubject,
} from "./CrewLibrarySearch";

type Member = MemberSearchSubject & { id: string; role: string; model: string; project: boolean };

const members: Member[] = [
  {
    id: "a",
    name: "Zed",
    instructions: "Reviews pull requests for accessibility",
    groups: ["UI"],
    role: "Reviewer",
    model: "Fixed: GPT-5",
    project: true,
  },
  {
    id: "b",
    name: "Amy",
    instructions: "",
    groups: ["Mobile", "UI"],
    role: "Specialist",
    model: "Automatic: 2 candidates",
    project: false,
  },
  { id: "c", name: "Bob", instructions: "", role: "Advisor", model: "No model", project: false },
];

const labels = (member: Member): MemberSearchLabels => ({
  role: member.role,
  model: member.model,
  candidates: member.id === "b" ? ["Claude Opus", "Sonnet"] : member.id === "a" ? ["GPT-5"] : [],
});

const search = (query: string, group = "") =>
  filterLibraryMembers(members, { query, group, labels }).map((member) => member.id);

describe("crew library search", () => {
  it("keeps every member in name order for an empty query", () => {
    expect(search("")).toEqual(["b", "c", "a"]);
    expect(search("   ")).toEqual(["b", "c", "a"]);
  });

  it("matches what the row shows: name, role, model summary and candidates", () => {
    expect(search("amy")).toEqual(["b"]);
    expect(search("reviewer")).toEqual(["a"]);
    expect(search("automatic")).toEqual(["b"]);
    expect(search("sonnet")).toEqual(["b"]);
    expect(search("gpt-5")).toEqual(["a"]);
    expect(search("no model")).toEqual(["c"]);
    // Scope labels share words, so they are not searched.
    expect(search("project")).toEqual([]);
  });

  it("still matches groups and instructions", () => {
    expect(search("mobile")).toEqual(["b"]);
    expect(search("accessibility")).toEqual(["a"]);
  });

  it("requires every term, in any order", () => {
    expect(search("ui specialist")).toEqual(["b"]);
    expect(search("specialist reviewer")).toEqual([]);
  });

  it("filters by an exact group before searching", () => {
    expect(search("", "UI")).toEqual(["b", "a"]);
    expect(search("amy", "UI")).toEqual(["b"]);
    expect(search("bob", "UI")).toEqual([]);
    expect(search("", "U")).toEqual([]);
  });

  it("builds a case-insensitive haystack", () => {
    const haystack = memberSearchHaystack(members[0]!, labels(members[0]!));
    expect(matchesMemberQuery(haystack, "REVIEWER")).toBe(true);
    expect(matchesMemberQuery(haystack, "ACCESSIBILITY")).toBe(true);
  });

  it("reports picked ids the filter hides", () => {
    const visible = filterLibraryMembers(members, { query: "amy", group: "", labels });
    expect(hiddenSelection(["a", "b", "c"], visible)).toEqual(["a", "c"]);
    expect(hiddenSelection([], visible)).toEqual([]);
    expect(hiddenSelection(["b"], visible)).toEqual([]);
  });
});
