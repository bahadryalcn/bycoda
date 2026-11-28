import { describe, expect, it } from "vitest";
import { pathKey } from "../../../shared/lib/paths";
import { newSession } from "./session";
import type { SessionSummary } from "../data/sessionStore";
import { summaryFromSession } from "../data/sessionHistory";
import { mergeGlobalRecentSessions } from "./globalRecentSessions";

const now = 2_000_000_000;
const cutoff = now - 7 * 24 * 60 * 60 * 1000;
function row(id: string, cwd = "G:/project", updatedAt = now): SessionSummary {
  return {
    id,
    cwd,
    updatedAt,
    createdAt: updatedAt,
    title: id,
    harness: "codex",
    model: "m",
    runtimeMode: "supervised",
  };
}
const allowed = new Set([
  pathKey("G:/project"),
  pathKey("remote://host-a/work"),
  pathKey("remote://host-b/work"),
]);

describe("global recent sessions", () => {
  it("keeps every age, orders by activity, and does not cap at 100", () => {
    const rows = Array.from({ length: 125 }, (_, i) => row(String(i), "G:/project", cutoff + i));
    rows.push(row("old", "G:/project", cutoff - 1));
    const result = mergeGlobalRecentSessions(rows, [], [], allowed);
    expect(result).toHaveLength(126);
    expect(result[0].id).toBe("124");
    expect(result[125].id).toBe("old");
  });

  it("keeps same IDs on separate remote machines and excludes hidden, archived and workers", () => {
    const rows = [
      row("same", "remote://host-a/work"),
      row("same", "remote://host-b/work"),
      row("private", "G:/hidden"),
      { ...row("archive"), archived: true },
      { ...row("worker"), orchestrationLeadId: "lead" },
    ];
    expect(mergeGlobalRecentSessions(rows, [], [], allowed).map((entry) => entry.cwd)).toEqual(
      ["remote://host-a/work", "remote://host-b/work"],
    );
  });

  it("keeps archived rows only when asked for archived, with the other filters intact", () => {
    const rows = [
      row("live"),
      { ...row("archive"), archived: true },
      { ...row("hidden", "G:/hidden"), archived: true },
      { ...row("worker"), archived: true, orchestrationLeadId: "lead" },
    ];
    expect(mergeGlobalRecentSessions(rows, [], [], allowed, true).map((r) => r.id)).toEqual([
      "archive",
    ]);
    expect(mergeGlobalRecentSessions(rows, [], [], allowed).map((r) => r.id)).toEqual(["live"]);
  });

  it("overlays live activity while retaining stored provenance and workspace metadata", () => {
    const session = {
      ...newSession("codex", "G:/project"),
      id: "live",
      title: "New title",
      historyPartial: true,
      blocks: [{ id: "u", role: "user" as const, text: "Hi", startedAt: now }],
    };
    const stored = {
      ...row("live", session.cwd, cutoff),
      branch: "feature",
      worktreeCwd: "G:/worktree",
      providerHistory: { providers: ["claude"] as const, activeHarness: "claude" as const },
    };
    expect(mergeGlobalRecentSessions([stored], [], [session], allowed)[0]).toMatchObject({
      title: "New title",
      lastActivityAt: now,
      branch: "feature",
      worktreeCwd: "G:/worktree",
      providerHistory: stored.providerHistory,
    });
    expect(
      mergeGlobalRecentSessions(
        [stored],
        [],
        [{ ...session, inboxAsk: {} } as typeof session],
        allowed,
      ),
    ).toEqual([]);
  });

  it("uses activity rather than maintenance writes for ordering", () => {
    const rows = [
      { ...row("older", "G:/project", now), lastActivityAt: cutoff + 1 },
      { ...row("newer", "G:/project", now - 1), lastActivityAt: cutoff + 2 },
      { ...row("oldest", "G:/project", now), lastActivityAt: cutoff - 1 },
    ];
    expect(mergeGlobalRecentSessions(rows, [], [], allowed).map((entry) => entry.id)).toEqual([
      "newer",
      "older",
      "oldest",
    ]);
  });

  it("takes provider history of a fully loaded live session from its summary", () => {
    const session = {
      ...newSession("codex", "G:/project"),
      id: "live",
      runningModelTarget: { harness: "claude" as const, model: "other", modelSettings: {} },
      blocks: [{ id: "u", role: "user" as const, text: "Hi", startedAt: now }],
    };
    const [result] = mergeGlobalRecentSessions([], [], [session], allowed);
    expect(result.providerHistory).toEqual(summaryFromSession(session).providerHistory);
    expect(result.providerHistory?.activeHarness).toBe("claude");
  });
});
