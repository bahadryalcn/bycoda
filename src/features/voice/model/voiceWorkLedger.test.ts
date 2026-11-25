import { describe, expect, it, vi } from "vitest";
import {
  VOICE_WORK_DUPLICATE_WINDOW_MS,
  VOICE_WORK_LEDGER_MAX_AGE_MS,
  VOICE_WORK_LEDGER_MAX_ENTRIES,
  VOICE_WORK_SEED_HEADER,
  VOICE_WORK_SEED_MAX_CHARS,
  VoiceWorkLedger,
  isTrackedVoiceWork,
  type VoiceWorkEntry,
  type VoiceWorkStorage,
} from "./voiceWorkLedger";

const T0 = 1_700_000_000_000;
function setup() {
  let now = T0;
  let saved: VoiceWorkEntry[] = [];
  const storage: VoiceWorkStorage = {
    load: () => saved.map((entry) => ({ ...entry })),
    save: (entries) => {
      saved = entries.map((entry) => ({ ...entry }));
    },
  };
  const make = () => new VoiceWorkLedger({ now: () => now, storage });
  return {
    ledger: make(),
    make,
    advance: (ms: number) => (now += ms),
    saved: () => saved,
  };
}
const create = { action: "workspace.sessions.create", args: { prompt: "fix login", submit: true } };
const startCreate = (ledger: VoiceWorkLedger, requestId = "req-1") =>
  ledger.start({
    tool: "app_tool_call",
    action: create.action,
    requestId,
    args: { ...create.args, requestId },
    request: "fix the login bug",
    projectPath: "G:\\Projects\\sample-project",
  })!;

describe("tracking", () => {
  it("tracks work tools and mutating actions only", () => {
    for (const tool of ["give_jobs", "submit_work", "stop_work", "assistant_job_control"])
      expect(isTrackedVoiceWork(tool)).toBe(true);
    for (const action of [
      "workspace.sessions.create",
      "workspace.sessions.submit",
      "workspace.sessions.stop",
      "tasks.create",
      "goals.create",
      "crews.start",
      "automations.create",
      "commands.run",
      "devServers.start",
      "something.unknown",
    ])
      expect(isTrackedVoiceWork("app_tool_call", action)).toBe(true);
    for (const action of ["workspace.sessions.list", "workspace.sessions.open", "tasks.get"])
      expect(isTrackedVoiceWork("app_tool_call", action)).toBe(false);
    expect(isTrackedVoiceWork("session_context")).toBe(false);
    expect(isTrackedVoiceWork("present_choices")).toBe(false);
  });

  it("does not record read-only calls", () => {
    const { ledger } = setup();
    expect(
      ledger.start({
        tool: "app_tool_call",
        action: "workspace.sessions.list",
        args: {},
        request: "show sessions",
      }),
    ).toBeUndefined();
    expect(ledger.entries()).toHaveLength(0);
  });
});

describe("start and settle", () => {
  it("uses the requestId as the id and generates one otherwise", () => {
    const { ledger } = setup();
    expect(startCreate(ledger)).toBe("req-1");
    const id = ledger.start({ tool: "submit_work", args: { text: "x" }, request: "do x" });
    expect(id).toMatch(/^work-/);
    expect(ledger.entries()).toHaveLength(2);
    expect(ledger.entries().every((entry) => entry.status === "running")).toBe(true);
  });

  it("maps a created session to done with its id and project", () => {
    const { ledger } = setup();
    const id = startCreate(ledger);
    const entry = ledger.settle(id, {
      action: create.action,
      status: "accepted",
      projectPath: "G:\\Projects\\sample-project",
      sessionId: "sess-9",
      submitted: true,
    });
    expect(entry).toMatchObject({ status: "done", sessionIds: ["sess-9"] });
    expect(entry?.settledAt).toBe(T0);
  });

  it("maps give_jobs receipts to job ids and the first title", () => {
    const { ledger } = setup();
    const id = ledger.start({ tool: "give_jobs", args: { jobs: [] }, request: "research it" })!;
    const entry = ledger.settle(id, {
      status: "accepted",
      jobs: [
        { id: "job-1", title: "Research X", status: "running", started: true },
        { id: "job-2", title: "Other", status: "queued", started: false },
      ],
      next: "Jobs started.",
    });
    expect(entry).toMatchObject({
      status: "done",
      jobIds: ["job-1", "job-2"],
      title: "Research X",
      outcome: "Jobs started.",
    });
  });

  it("links the session of a submit from its arguments", () => {
    const { ledger } = setup();
    const id = ledger.start({
      tool: "app_tool_call",
      action: "workspace.sessions.submit",
      args: { sessionId: "sess-2", text: "go", requestId: "r2" },
      requestId: "r2",
      request: "send it",
    })!;
    expect(
      ledger.settle(id, { sessionId: "sess-2", status: "accepted", accepted: true }),
    ).toMatchObject({ status: "done", sessionIds: ["sess-2"] });
  });

  it("reads ids nested under result", () => {
    const { ledger } = setup();
    const id = startCreate(ledger);
    expect(ledger.settle(id, { result: { sessionId: "nested", title: "T" } })).toMatchObject({
      sessionIds: ["nested"],
      title: "T",
    });
  });

  it("maps errors, failed status, uncertain status and thrown errors", () => {
    const { ledger } = setup();
    expect(
      ledger.settle(startCreate(ledger, "a"), { error: "No session is selected." }),
    ).toMatchObject({ status: "failed", outcome: "No session is selected." });
    expect(
      ledger.settle(startCreate(ledger, "b"), { status: "failed", error: "boom" }),
    ).toMatchObject({ status: "failed" });
    expect(
      ledger.settle(startCreate(ledger, "c"), { status: "uncertain", error: "timed out" }),
    ).toMatchObject({ status: "uncertain", outcome: "timed out" });
    expect(ledger.settle(startCreate(ledger, "d"), undefined, new Error("deadline"))).toMatchObject(
      { status: "uncertain", outcome: "deadline" },
    );
  });

  it("removes refusals where nothing was dispatched", () => {
    const { ledger } = setup();
    const refusals: unknown[] = [
      { accepted: false, status: "refused", error: "No work was submitted." },
      { accepted: false },
      { status: "rejected", created: 0, error: "bad project" },
      { status: "awaiting_review", reviewId: "r" },
      { status: "cancelled" },
    ];
    refusals.forEach((result, index) => {
      const id = startCreate(ledger, `r${index}`);
      expect(ledger.settle(id, result)).toBeUndefined();
    });
    expect(ledger.entries()).toHaveLength(0);
  });

  it("still records a result that settles after the voice socket is gone", () => {
    const { ledger, make, saved } = setup();
    const id = startCreate(ledger);
    // The socket closed here; the settle call does not depend on it.
    ledger.settle(id, { sessionId: "late-1", status: "accepted" });
    expect(make().entries()[0]).toMatchObject({ status: "done", sessionIds: ["late-1"] });
    expect(saved()).toHaveLength(1);
  });

  it("ignores an unknown id and notifies subscribers", () => {
    const { ledger } = setup();
    const listener = vi.fn();
    const off = ledger.subscribe(listener);
    expect(ledger.settle("nope", {})).toBeUndefined();
    startCreate(ledger);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    ledger.settle("req-1", {});
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("duplicates", () => {
  const probe = { tool: "app_tool_call", action: create.action, args: create.args };

  it("finds a running or recently done identical call, ignoring requestId", () => {
    const { ledger, advance } = setup();
    const id = startCreate(ledger);
    expect(ledger.findDuplicate(probe)?.id).toBe(id);
    ledger.settle(id, { sessionId: "s1" });
    advance(VOICE_WORK_DUPLICATE_WINDOW_MS - 1);
    expect(
      ledger.findDuplicate({
        ...probe,
        args: { submit: true, prompt: "fix login", requestId: "other" },
      }),
    ).toBeDefined();
    advance(2);
    expect(ledger.findDuplicate(probe)).toBeUndefined();
  });

  it("does not match different args or failed calls", () => {
    const { ledger } = setup();
    const id = startCreate(ledger);
    expect(
      ledger.findDuplicate({ ...probe, args: { prompt: "other", submit: true } }),
    ).toBeUndefined();
    expect(ledger.findDuplicate({ ...probe, action: "workspace.sessions.submit" })).toBeUndefined();
    ledger.settle(id, { error: "x" });
    expect(ledger.findDuplicate(probe)).toBeUndefined();
  });

  it("with a request, matches only work caused by the same utterance", () => {
    const { ledger } = setup();
    startCreate(ledger);
    expect(ledger.findDuplicate({ ...probe, request: "  fix the   login bug " })).toBeDefined();
    expect(ledger.findDuplicate({ ...probe, request: "fix the signup bug" })).toBeUndefined();
  });
});

describe("observe", () => {
  const created = (ledger: VoiceWorkLedger) => {
    const id = startCreate(ledger);
    ledger.settle(id, { sessionId: "s1", status: "accepted" });
    return id;
  };

  it("reports busy to idle once and ignores later changes", () => {
    const { ledger } = setup();
    created(ledger);
    expect(ledger.observe({ sessions: [{ id: "s1", busy: false }], jobs: [] })).toEqual([]);
    expect(ledger.entries()[0]!.progress).toBe("idle");
    expect(
      ledger.observe({ sessions: [{ id: "s1", busy: true, title: "Fix" }], jobs: [] }),
    ).toEqual([]);
    expect(ledger.entries()[0]).toMatchObject({ progress: "working", title: "Fix" });
    const done = ledger.observe({ sessions: [{ id: "s1", busy: false }], jobs: [] });
    expect(done).toHaveLength(1);
    expect(done[0]!.progress).toBe("finished");
    expect(ledger.observe({ sessions: [{ id: "s1", busy: false }], jobs: [] })).toEqual([]);
    expect(ledger.observe({ sessions: [{ id: "s1", busy: true }], jobs: [] })).toEqual([]);
    expect(ledger.entries()[0]!.progress).toBe("finished");
  });

  it("reports a flagged session as failed", () => {
    const { ledger } = setup();
    created(ledger);
    ledger.observe({ sessions: [{ id: "s1", busy: true }], jobs: [] });
    const out = ledger.observe({ sessions: [{ id: "s1", busy: false, failed: true }], jobs: [] });
    expect(out[0]!.progress).toBe("failed");
  });

  it("follows linked jobs through terminal statuses", () => {
    const { ledger } = setup();
    const id = ledger.start({ tool: "give_jobs", args: {}, request: "r" })!;
    ledger.settle(id, { jobs: [{ id: "j1", title: "J" }] });
    expect(ledger.observe({ sessions: [], jobs: [{ id: "j1", status: "running" }] })).toEqual([]);
    expect(ledger.entries()[0]!.progress).toBe("working");
    expect(
      ledger.observe({ sessions: [], jobs: [{ id: "j1", status: "done" }] })[0]!.progress,
    ).toBe("finished");
    const other = ledger.start({ tool: "give_jobs", args: { n: 2 }, request: "r" })!;
    ledger.settle(other, { jobs: [{ id: "j2" }] });
    expect(
      ledger.observe({ sessions: [], jobs: [{ id: "j2", status: "cancelled" }] })[0]!.progress,
    ).toBe("failed");
  });

  it("leaves done entries without an observed link alone", () => {
    const { ledger } = setup();
    created(ledger);
    expect(ledger.observe({ sessions: [], jobs: [] })).toEqual([]);
    expect(ledger.entries()[0]!.progress).toBeUndefined();
  });
});

describe("bounds and persistence", () => {
  it("keeps the newest 30 entries", () => {
    const { ledger, advance } = setup();
    for (let index = 0; index < 35; index++) {
      advance(1);
      ledger.start({
        tool: "submit_work",
        args: { index },
        request: `r${index}`,
        requestId: `q${index}`,
      });
    }
    expect(ledger.entries()).toHaveLength(VOICE_WORK_LEDGER_MAX_ENTRIES);
    expect(ledger.entries()[0]!.id).toBe("q34");
    expect(ledger.entries().some((entry) => entry.id === "q0")).toBe(false);
  });

  it("drops entries older than 24 hours", () => {
    const { ledger, advance } = setup();
    startCreate(ledger);
    advance(VOICE_WORK_LEDGER_MAX_AGE_MS + 1);
    ledger.start({ tool: "submit_work", args: {}, request: "new", requestId: "fresh" });
    expect(ledger.entries().map((entry) => entry.id)).toEqual(["fresh"]);
    expect(ledger.seed()).not.toContain("req-1");
  });

  it("truncates long requests and outcomes", () => {
    const { ledger } = setup();
    const id = ledger.start({ tool: "submit_work", args: {}, request: "word ".repeat(200) })!;
    ledger.settle(id, { error: "e".repeat(1000) });
    const entry = ledger.entries()[0]!;
    expect(entry.request.length).toBeLessThanOrEqual(210);
    expect((entry.outcome ?? "").length).toBeLessThanOrEqual(210);
  });

  it("round-trips through storage and marks lost running calls uncertain", () => {
    const { ledger, make } = setup();
    ledger.settle(startCreate(ledger, "kept"), { sessionId: "s1" });
    startCreate(ledger, "lost");
    const reloaded = make().entries();
    expect(reloaded.find((entry) => entry.id === "kept")).toMatchObject({
      status: "done",
      sessionIds: ["s1"],
    });
    expect(reloaded.find((entry) => entry.id === "lost")).toMatchObject({ status: "uncertain" });
  });
});

describe("seed", () => {
  it("is empty without entries", () => {
    expect(setup().ledger.seed()).toBe("");
  });

  it("starts with the exact header and carries full ids, project and request", () => {
    const { ledger } = setup();
    const id = startCreate(ledger);
    ledger.settle(id, { sessionId: "session-0123456789abcdef", title: "Fix login" });
    ledger.observe({ sessions: [{ id: "session-0123456789abcdef", busy: true }], jobs: [] });
    const [header, line] = ledger.seed().split("\n");
    expect(header).toBe(VOICE_WORK_SEED_HEADER);
    expect(line).toContain("done");
    expect(line).toContain("workspace.sessions.create");
    expect(line).toContain("Fix login");
    expect(line).toContain("session-0123456789abcdef");
    expect(line).toContain("sample-project");
    expect(line).toContain("now working");
    expect(line).toContain('"fix the login bug"');
  });

  it("flags uncertain work as unknown and to be checked before retrying", () => {
    const { ledger } = setup();
    ledger.settle(startCreate(ledger), undefined, new Error("timeout"));
    expect(ledger.seed()).toMatch(/outcome unknown.*before retrying/);
  });

  it("lists newest first and cuts on whole lines within the bound", () => {
    const { ledger, advance } = setup();
    for (let index = 0; index < 30; index++) {
      advance(1000);
      const id = ledger.start({
        tool: "submit_work",
        args: { index },
        request: "a long request ".repeat(30),
        requestId: `id-${index}`,
        projectPath: "C:\\x\\project",
      })!;
      ledger.settle(id, { sessionId: `session-${index}-${"z".repeat(30)}` });
    }
    const seed = ledger.seed();
    expect(seed.length).toBeLessThanOrEqual(VOICE_WORK_SEED_MAX_CHARS);
    const lines = seed.split("\n");
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.length).toBeLessThan(31);
    expect(lines[1]).toContain("session-29-");
    for (const line of lines.slice(1)) expect(line).toMatch(/owner asked: ".*"$/);
  });

  it("leaves out entries the caller hides, and is empty when nothing is visible", () => {
    const { ledger } = setup();
    ledger.settle(startCreate(ledger), { sessionId: "s-visible" });
    ledger.settle(
      ledger.start({
        tool: "submit_work",
        args: { text: "secret" },
        request: "hidden work",
        projectPath: "C:\\locked",
      })!,
      { sessionId: "s-hidden" },
    );
    const seed = ledger.seed((entry) => entry.projectPath !== "C:\\locked");
    expect(seed).toContain("s-visible");
    expect(seed).not.toContain("s-hidden");
    expect(ledger.seed(() => false)).toBe("");
  });
});
