import { describe, expect, it } from "vitest";
import { pathKey } from "../../../shared/lib/paths";
import { newSession } from "./session";
import type { SessionSummary } from "../data/sessionStore";
import { buildGlobalRecentSessions, GLOBAL_RECENT_WINDOW_MS } from "./globalRecentSessions";

const now = 2_000_000_000;
const cutoff = now - GLOBAL_RECENT_WINDOW_MS;
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
  it("includes the exact seven-day boundary, orders by activity, and does not cap at 100", () => {
    const rows = Array.from({ length: 125 }, (_, i) => row(String(i), "G:/project", cutoff + i));
    rows.push(row("boundary", "G:/project", cutoff), row("old", "G:/project", cutoff - 1));
    const result = buildGlobalRecentSessions(rows, [], [], allowed, now);
    expect(result).toHaveLength(126);
    expect(result[0].id).toBe("124");
    expect(result.some((entry) => entry.id === "boundary")).toBe(true);
    expect(result.some((entry) => entry.id === "old")).toBe(false);
  });

  it("keeps same IDs on separate remote machines and excludes hidden, archived and workers", () => {
    const rows = [
      row("same", "remote://host-a/work"),
      row("same", "remote://host-b/work"),
      row("private", "G:/hidden"),
      { ...row("archive"), archived: true },
      { ...row("worker"), orchestrationLeadId: "lead" },
    ];
    expect(buildGlobalRecentSessions(rows, [], [], allowed, now).map((entry) => entry.cwd)).toEqual(
      ["remote://host-a/work", "remote://host-b/work"],
    );
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
    expect(buildGlobalRecentSessions([stored], [], [session], allowed, now)[0]).toMatchObject({
      title: "New title",
      lastActivityAt: now,
      branch: "feature",
      worktreeCwd: "G:/worktree",
      providerHistory: stored.providerHistory,
    });
    expect(
      buildGlobalRecentSessions(
        [stored],
        [],
        [{ ...session, inboxAsk: {} } as typeof session],
        allowed,
        now,
      ),
    ).toEqual([]);
  });

  it("uses activity rather than maintenance writes for ordering and the seven-day window", () => {
    const rows = [
      { ...row("older", "G:/project", now), lastActivityAt: cutoff + 1 },
      { ...row("newer", "G:/project", now - 1), lastActivityAt: cutoff + 2 },
      { ...row("expired", "G:/project", now), lastActivityAt: cutoff - 1 },
    ];
    expect(buildGlobalRecentSessions(rows, [], [], allowed, now).map((entry) => entry.id)).toEqual([
      "newer",
      "older",
    ]);
  });
});
