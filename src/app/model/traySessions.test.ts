import { describe, expect, it } from "vitest";
import { traySessions } from "./traySessions";
import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import type { LiveSessionInfo } from "../../features/sessions/model/recentSessions";

const stored = (id: string, extra: Partial<SessionSummary> = {}): SessionSummary => ({
  id,
  cwd: "/visible",
  title: id,
  harness: "codex",
  model: "",
  runtimeMode: "full-auto",
  createdAt: 1,
  updatedAt: 50,
  ...extra,
});
const live = (id: string, status?: LiveSessionInfo["status"]): LiveSessionInfo => ({
  id,
  cwd: "/visible",
  title: id,
  harness: "codex",
  model: "",
  activityAt: 10,
  status,
});
const options = {
  projectKeys: new Set(["/visible"]),
  ownedKeys: {},
  agents: [],
  live: [],
  stored: [],
};

describe("session menu rows", () => {
  it("keeps project and provider readable when a title is long or multiline", () => {
    const [row] = traySessions({
      ...options,
      stored: [stored("long", { title: `  Fix\n${"ş".repeat(100)}` })],
    });
    expect(row.label).toBe(`Fix ${"ş".repeat(43)}… — visible · Codex`);
    expect(row.label).not.toContain("\n");
    expect(row.label).not.toMatch(/^(Working|Active|Done|Needs input)/);
  });
  it("uses the provider as a fallback title without repeating it", () => {
    const [row] = traySessions({
      ...options,
      stored: [stored("untitled", { title: "  \n " })],
    });
    expect(row.label).toBe("Codex — visible");
  });
  it("does not resurrect a stale remote working summary", () => {
    const rows = traySessions({
      ...options,
      live: [live("host")],
      agents: [
        {
          id: "host",
          cwd: "/visible",
          title: "Remote run",
          harness: "codex",
          activity: "",
          needsApproval: false,
          done: false,
        },
      ],
    });
    expect(rows[0].status).toBe("active");
  });
  it("overlays working, input and unseen completion without calling idle history completed", () => {
    const rows = traySessions({
      ...options,
      stored: [stored("work"), stored("ask"), stored("finish"), stored("idle")],
      live: [live("work", "working"), live("ask", "input"), live("finish", "done")],
    });
    expect(Object.fromEntries(rows.map((row) => [row.id, row.status]))).toEqual({
      work: "working",
      ask: "input",
      finish: "done",
      idle: "active",
    });
    expect(rows.find((row) => row.id === "work")?.updatedAt).toBe(50);
  });
  it("excludes locked projects, archived rows, drafts and orchestration child history", () => {
    expect(
      traySessions({
        ...options,
        stored: [
          stored("hidden", { cwd: "/locked" }),
          stored("archive", { archived: true }),
          stored("draft", { draft: true }),
          stored("child", { orchestrationLeadId: "lead" }),
        ],
        live: [{ ...live("hidden-live", "working"), cwd: "/locked" }],
      }),
    ).toEqual([]);
  });
  it("uses canonical remote identity while preserving the local navigation ID", () => {
    const rows = traySessions({
      ...options,
      live: [live("local", "input")],
      ownedKeys: { local: "host-id" },
    });
    expect(rows[0]).toMatchObject({
      id: "local",
      key: "host-id",
      owned: true,
      status: "input",
    });
  });
  it("includes host summaries independently of the rail display preference", () => {
    const rows = traySessions({
      ...options,
      agents: [
        {
          id: "host",
          cwd: "/visible",
          title: "Remote run",
          harness: "codex",
          activity: "",
          needsApproval: true,
          done: false,
        },
      ],
    });
    expect(rows[0]).toMatchObject({ status: "input", owned: false });
  });
});
