import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, Session } from "../../sessions/model/session";
import { recordUiLog } from "../../diagnostics";
import {
  mirrorAdoptedSessions,
  type AdoptedEntry,
  type AdoptedMirrorDeps,
} from "./adoptedSessions";
import { ADOPTED_SYNC_FAILURE_FLAG_AFTER, adoptedSyncFailing } from "./adoptedSyncFailures";
import type { HostSession } from "./protocol";

vi.mock("../../diagnostics", () => ({ recordUiLog: vi.fn() }));

/** A pass that is never the only thing between two fetches: longer than any backoff here. */
const PAST_BACKOFF_MS = 60_000;

const block: Block = { id: "u", role: "user", text: "u" };
const session = (over: Partial<Session> = {}): Session =>
  ({
    id: "s1",
    harness: "claude",
    model: "m",
    modelSettings: {},
    runtimeMode: "ask",
    title: "Title",
    cwd: "C:/proj",
    blocks: [block],
    ...over,
  }) as Session;
const entry = (over: Partial<AdoptedEntry> = {}): AdoptedEntry => ({
  id: "s1",
  projectId: "p",
  revision: 5,
  updatedAt: 10,
  status: "idle",
  ...over,
});
/** The host copy holds the same transcript as the desktop copy: it merges. */
const hostCopy = (revision = 5): HostSession => ({
  session: session({ cwd: "/other" }),
  projectId: "p",
  revision,
  status: "idle",
  updatedAt: 10,
});
const unreadable = async (): Promise<HostSession> => {
  throw new Error("Bearer abcdef123456 unreadable");
};

function mirror(load: () => Promise<HostSession>) {
  let current = session();
  let listing: AdoptedEntry[] = [entry()];
  const mirrored = new Map<string, number>();
  const apply = vi.fn((merged: Session) => {
    current = merged;
  });
  const conflict = vi.fn();
  const loadHost = vi.fn(load);
  const deps = {
    list: async () => listing,
    load: loadHost,
    local: () => [current],
    apply,
    mirrored,
    conflict,
  } as unknown as AdoptedMirrorDeps;
  return {
    pass: () => mirrorAdoptedSessions(deps),
    load: loadHost,
    apply,
    conflict,
    mirrored,
    list: (next: AdoptedEntry[]) => {
      listing = next;
    },
  };
}

/** Passes that each fail, with time moving past any backoff between them. */
async function failPasses(m: ReturnType<typeof mirror>, passes: number) {
  for (let i = 0; i < passes; i++) {
    await m.pass();
    vi.advanceTimersByTime(PAST_BACKOFF_MS);
  }
}

describe("adopted session sync failures", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    vi.setSystemTime(1_000_000);
    vi.mocked(recordUiLog).mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not fetch a session that keeps failing again until its backoff has passed", async () => {
    const m = mirror(unreadable);
    await m.pass();
    await m.pass();
    expect(m.load).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(6_000);
    await m.pass();
    expect(m.load).toHaveBeenCalledTimes(2);

    await m.pass();
    expect(m.load).toHaveBeenCalledTimes(2);
  });

  it("fetches a failing session at once when the host moved to a new revision", async () => {
    const m = mirror(unreadable);
    await m.pass();
    m.list([entry({ revision: 6 })]);
    await m.pass();
    expect(m.load).toHaveBeenCalledTimes(2);
  });

  it("flags a session through the sync row once it has failed enough passes in a row", async () => {
    const m = mirror(unreadable);
    await failPasses(m, ADOPTED_SYNC_FAILURE_FLAG_AFTER - 1);
    expect(m.conflict).not.toHaveBeenCalled();

    await m.pass();
    expect(m.conflict).toHaveBeenCalledTimes(1);
    expect(m.conflict).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }));
    expect(adoptedSyncFailing(m.mirrored, entry())).toBe(true);
  });

  it("stops the fast polling cadence for a session that keeps failing at its revision", async () => {
    const m = mirror(unreadable);
    await failPasses(m, ADOPTED_SYNC_FAILURE_FLAG_AFTER);
    expect(adoptedSyncFailing(m.mirrored, entry())).toBe(true);
    // A new host revision is a new chance, not a failing one.
    expect(adoptedSyncFailing(m.mirrored, entry({ revision: 6 }))).toBe(false);
  });

  it("clears the failure streak once the session merges again", async () => {
    let broken = true;
    const m = mirror(async () => {
      if (broken) return unreadable();
      return hostCopy();
    });
    await failPasses(m, ADOPTED_SYNC_FAILURE_FLAG_AFTER);
    expect(adoptedSyncFailing(m.mirrored, entry())).toBe(true);

    broken = false;
    await m.pass();
    expect(m.apply).toHaveBeenCalledTimes(1);
    expect(m.mirrored.get("s1")).toBe(5);
    expect(adoptedSyncFailing(m.mirrored, entry())).toBe(false);
  });

  it("logs a persistent failure once, with its error redacted", async () => {
    const m = mirror(unreadable);
    await failPasses(m, ADOPTED_SYNC_FAILURE_FLAG_AFTER + 1);

    expect(recordUiLog).toHaveBeenCalledTimes(1);
    const [level, category, , fields] = vi.mocked(recordUiLog).mock.calls[0]!;
    expect([level, category]).toEqual(["warn", "ui.adopted"]);
    expect(fields).toEqual(expect.objectContaining({ scope: "open", failures: 3 }));
    expect(JSON.stringify(fields)).not.toContain("abcdef123456");
  });

  it("backs off a closed session whose stored copy keeps failing to read", async () => {
    const stored = vi.fn(async () => {
      throw new Error("disk");
    });
    const deps = {
      list: async () => [entry()],
      load: vi.fn(async () => hostCopy()),
      local: () => [],
      apply: vi.fn(),
      mirrored: new Map<string, number>(),
      stored,
      save: vi.fn(async () => true),
    } as unknown as AdoptedMirrorDeps;

    await mirrorAdoptedSessions(deps);
    await mirrorAdoptedSessions(deps);
    expect(stored).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(6_000);
    await mirrorAdoptedSessions(deps);
    expect(stored).toHaveBeenCalledTimes(2);
  });
});
