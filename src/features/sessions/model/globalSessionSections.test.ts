import { describe, expect, it } from "vitest";
import type { SessionSummary } from "../data/sessionStore";
import {
  buildGlobalSessionSections,
  DEFAULT_GLOBAL_SESSION_LIST_PREFS,
  globalSessionQuerySince,
  parseGlobalSessionListPrefs,
  visibleGlobalSections,
} from "./globalSessionSections";

function row(id: string, cwd: string, at: number, extra: Partial<SessionSummary> = {}) {
  return {
    id,
    cwd,
    updatedAt: at,
    createdAt: at,
    title: id,
    harness: "codex",
    model: "m",
    runtimeMode: "supervised",
    ...extra,
  } satisfies SessionSummary;
}

const sessions = [
  row("scratch", "~", 9),
  row("a1", "G:/a", 8),
  row("pinned-old", "G:/b", 1, { pinned: true }),
  row("b1", "G:/b", 7),
  row("settled", "G:/a", 6),
  row("pinned-settled", "G:/a", 5, { pinned: true }),
  row("a2", "G:/a", 4),
];
const settled = (session: SessionSummary) => session.id.includes("settled");
const shape = (sections: ReturnType<typeof buildGlobalSessionSections>) =>
  sections.map((section) => [
    section.kind === "group" ? section.key : section.kind,
    section.sessions.map((session) => session.id),
  ]);

describe("buildGlobalSessionSections", () => {
  it("lists Pinned, projects, No project, then the Settled shelf", () => {
    expect(
      shape(
        buildGlobalSessionSections(
          sessions,
          { groupBy: "project", sort: "newest" },
          () => "idle",
          settled,
        ),
      ),
    ).toEqual([
      ["pinned", ["pinned-old", "pinned-settled"]],
      ["g:/a", ["a1", "a2"]],
      ["g:/b", ["b1"]],
      ["~", ["scratch"]],
      ["settled", ["settled"]],
    ]);
  });

  it("keeps settled sessions in place when the Settled filter lists only them", () => {
    expect(
      shape(
        buildGlobalSessionSections(sessions, { groupBy: "none", sort: "oldest" }, () => "idle"),
      ),
    ).toEqual([
      ["pinned", ["pinned-old", "pinned-settled"]],
      ["", ["a2", "settled", "b1", "a1", "scratch"]],
    ]);
  });

  it("hides collapsed groups unless search expands them", () => {
    const view = { groupBy: "project", sort: "newest" } as const;
    const sections = buildGlobalSessionSections(sessions, view, () => "idle", settled);
    const collapsed = new Set(["pinned", "project:g:/a", "settled"]);
    const shown = (expand: boolean) =>
      visibleGlobalSections(sections, view, (key) => collapsed.has(key), expand).flatMap((entry) =>
        entry.shown.map((session) => session.id),
      );
    expect(shown(false)).toEqual(["b1", "scratch"]);
    expect(shown(true)).toHaveLength(sessions.length);
  });
});

describe("catalog totals", () => {
  it("adds unloaded projects, orders by catalog activity and reports full counts", () => {
    const sections = buildGlobalSessionSections(
      sessions,
      { groupBy: "project", sort: "newest" },
      () => "idle",
      settled,
      {
        projects: [
          { key: "g:/c", cwd: "G:/c", count: 40, latestActivityAt: 100 },
          { key: "g:/a", cwd: "G:/a", count: 12, latestActivityAt: 8 },
        ],
        settledCount: 900,
      },
    );
    expect(
      sections.map((section) => [
        section.kind === "group" ? section.key : section.kind,
        "total" in section ? section.total : section.sessions.length,
      ]),
    ).toEqual([
      ["pinned", 2],
      ["g:/c", 40],
      ["g:/a", 12],
      ["g:/b", 1],
      ["~", 1],
      ["settled", 900],
    ]);
  });
});

describe("globalSessionQuerySince", () => {
  it("rounds windows down to the hour and leaves All time unbounded", () => {
    const now = Date.UTC(2026, 10, 28, 15, 42, 10);
    expect(globalSessionQuerySince("all", now)).toBeUndefined();
    expect(globalSessionQuerySince("7d", now)).toBe(Date.UTC(2026, 10, 21, 15));
    expect(globalSessionQuerySince("7d", now + 60_000)).toBe(globalSessionQuerySince("7d", now));
    expect(globalSessionQuerySince("today", now)).toBeLessThanOrEqual(now);
  });
});

describe("parseGlobalSessionListPrefs", () => {
  it("defaults to project grouping and drops unknown values", () => {
    expect(parseGlobalSessionListPrefs("null")).toEqual(DEFAULT_GLOBAL_SESSION_LIST_PREFS);
    expect(
      parseGlobalSessionListPrefs(
        JSON.stringify({ view: { groupBy: "state", sort: "oldest" }, collapsed: ["pinned", 3] }),
      ),
    ).toEqual({ view: { groupBy: "state", sort: "oldest" }, collapsed: ["pinned"] });
  });
});
