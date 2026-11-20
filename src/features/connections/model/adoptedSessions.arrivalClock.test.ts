import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../../sessions/model/session";
import {
  mirrorAdoptedSessions,
  type AdoptedEntry,
  type AdoptedMirrorDeps,
} from "./adoptedSessions";
import type { HostSession } from "./protocol";

/** The arrival wait for a finished host turn must count only time the host was
 * actually listed, so a laptop sleep or an outage never reads as "not arrived". */
const ARRIVAL_LIMIT_MS = 60_000;
const PASS_MS = 5_000;

const session = (over: Partial<Session> = {}): Session =>
  ({
    id: "s1",
    harness: "claude",
    model: "m",
    modelSettings: {},
    runtimeMode: "ask",
    title: "Title",
    cwd: "C:/proj",
    blocks: [{ id: "u", role: "user", text: "u" }],
    ...over,
  }) as Session;

const entry = (over: Partial<AdoptedEntry> = {}): AdoptedEntry => ({
  id: "s1",
  projectId: "p",
  revision: 5,
  updatedAt: 10,
  status: "running",
  ...over,
});

function harness(initial: Session) {
  let current = initial;
  let listing: AdoptedEntry[] = [entry()];
  let failListing = false;
  const mirrored = new Map<string, number>();
  const conflict = vi.fn();
  const onRunning = vi.fn();
  const deps = {
    list: async () => {
      if (failListing) throw new Error("offline");
      return listing;
    },
    // The host copy never arrives in these tests: a load always fails.
    load: async (): Promise<HostSession> => {
      throw new Error("not readable yet");
    },
    local: () => [current],
    apply: (merged: Session) => {
      current = merged;
    },
    mirrored,
    conflict,
    onRunning,
  } as unknown as AdoptedMirrorDeps;
  return {
    pass: () => mirrorAdoptedSessions(deps),
    finish: (revision = 6) => {
      listing = [entry({ status: "idle", revision })];
    },
    setFailing: (value: boolean) => {
      failListing = value;
    },
    conflict,
    onRunning,
    heldNow: () => onRunning.mock.lastCall?.[0] as Set<string>,
  };
}

describe("the arrival wait for a finished host turn", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is not judged on the first pass after the laptop wakes", async () => {
    const h = harness(session());
    await h.pass();
    h.finish();
    await h.pass(); // finished on the host, not readable yet: the wait starts here
    expect(h.heldNow().has("s1")).toBe(true);

    // The laptop sleeps for ten minutes between two passes.
    vi.advanceTimersByTime(10 * 60_000);
    await h.pass();

    expect(h.conflict).not.toHaveBeenCalled();
    expect(h.heldNow().has("s1")).toBe(true);
  });

  it("does not count the time the host was unreachable", async () => {
    const h = harness(session());
    await h.pass();
    h.finish();
    await h.pass();
    h.setFailing(true);
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(PASS_MS);
      await expect(h.pass()).rejects.toThrow("offline");
    }
    h.setFailing(false);
    // Back online right after an outage that lasted longer than the limit.
    vi.advanceTimersByTime(PASS_MS);
    await h.pass();
    expect(h.conflict).not.toHaveBeenCalled();
  });

  it("still hands the conversation to an explicit sync when the host never delivers", async () => {
    const h = harness(session());
    await h.pass();
    h.finish();
    await h.pass();
    const passesNeeded = ARRIVAL_LIMIT_MS / PASS_MS + 1;
    for (let i = 0; i < passesNeeded; i++) {
      vi.advanceTimersByTime(PASS_MS);
      await h.pass();
    }
    expect(h.conflict).toHaveBeenCalledOnce();
    expect(h.heldNow().has("s1")).toBe(false);
  });
});
