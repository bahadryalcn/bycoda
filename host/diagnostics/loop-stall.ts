import { readdir, rm } from "node:fs/promises";
import { Session } from "node:inspector/promises";
import { join } from "node:path";
import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";
import { writeFileAtomic } from "../storage/atomic-write";
import type { Logger } from "./logger";

const TICK_MS = 200;
/** A tick this late means the event loop could not answer anything for that long. */
const STALL_MS = 500;
const WARN_EVERY_MS = 10_000;
/** Repeated stalls inside the window start one CPU profile, at most hourly. */
const PROFILE_AFTER_STALLS = 3;
const PROFILE_WINDOW_MS = 60_000;
const PROFILE_MS = 30_000;
const PROFILE_EVERY_MS = 60 * 60_000;
const PROFILES_KEPT = 3;
/** Profiling starts only on a tick this long after the last stall, never inside a load wave. */
const PROFILE_IDLE_MS = 10_000;
/** Wall-minus-monotonic drift this far above the tick means the machine was suspended. */
const SUSPEND_DRIFT_MS = 1_000;
/**
 * A gap this long with both clocks agreeing is a pause, not a stall: Windows' monotonic clock
 * keeps running through sleep, so only this threshold catches a sleep there. A real stall of
 * this length would have shown as many shorter ones first.
 */
const PAUSE_MS = 30_000;
const INFLIGHT_MAX = 2_000;
const INFLIGHT_REPORTED = 5;

// Method name and start time only, never payloads. Bounded so a leaked `done` cannot grow it.
const inflight = new Map<number, { method: string; startedAt: number }>();
let inflightId = 0;
let completedRpcs = 0;
/** Longest RPCs that settled since the last tick: a synchronous blocker ends before the tick. */
let finished: { method: string; ms: number }[] = [];
const FINISHED_REPORTED = 3;
/** A finished call shorter than this cannot explain a stall. */
const FINISHED_MIN_MS = 100;
const METHOD_NAME_MAX = 64;

/**
 * Marks an RPC as in flight; call the returned function exactly once when it settles.
 * `held` calls (long polls open by design) are counted but never named as a stall suspect.
 * The caller passes only a registered method name; anything else is recorded as "unknown".
 */
export function trackRpc(
  method: string,
  now: () => number = monotonicNow,
  held = false,
): () => void {
  const id = ++inflightId;
  const name = method.slice(0, METHOD_NAME_MAX);
  const startedAt = now();
  if (inflight.size >= INFLIGHT_MAX) {
    const oldest = inflight.keys().next().value;
    if (oldest !== undefined) inflight.delete(oldest);
  }
  if (!held) inflight.set(id, { method: name, startedAt });
  let settled = false;
  return () => {
    if (settled) return;
    settled = true;
    completedRpcs++;
    if (held) return;
    inflight.delete(id);
    const ms = Math.round(elapsedSince(startedAt, now()));
    if (ms < FINISHED_MIN_MS) return;
    finished.push({ method: name, ms });
    if (finished.length > FINISHED_REPORTED * 4) {
      finished = finished.sort((a, b) => b.ms - a.ms).slice(0, FINISHED_REPORTED);
    }
  };
}
const takeFinished = () => {
  const longest = finished.sort((a, b) => b.ms - a.ms).slice(0, FINISHED_REPORTED);
  finished = [];
  return longest;
};
const PROFILE_FILE = /^stall-.+\.cpuprofile$/;

/** Records the main thread for `durationMs` and returns a `.cpuprofile` JSON document. */
export type StallProfiler = (durationMs: number) => Promise<string>;

// Off by default: `Profiler.start` itself freezes the main thread (0.8–3.4 s measured on a
// busy Host), so stall profiles are a developer switch (Settings > General > Diagnostics).
let stallProfilesEnabled = false;
/** The owner's Host setting, applied at start-up and on each save. */
export function setStallProfilesEnabled(enabled: boolean) {
  stallProfilesEnabled = enabled;
}

async function inspectorProfile(durationMs: number): Promise<string> {
  const session = new Session();
  session.connect();
  try {
    await session.post("Profiler.enable");
    await session.post("Profiler.setSamplingInterval", { interval: 1000 });
    await session.post("Profiler.start");
    await new Promise((resolve) => setTimeout(resolve, durationMs).unref());
    const { profile } = await session.post("Profiler.stop");
    return JSON.stringify(profile);
  } finally {
    session.disconnect();
  }
}

/**
 * Reports event-loop stalls when they happen. The 15-minute health p99 hides
 * second-long freezes, and a stalled Host shows only as slow, unrelated requests.
 * With `profileDir` and profiles enabled, repeated stalls also save a short CPU profile
 * there, so the blocking code is named without attaching a debugger.
 */
export function watchLoopStalls(options: {
  log: Logger;
  profileDir?: string;
  profiler?: StallProfiler;
  profilesEnabled?: () => boolean;
  now?: () => number;
  /** Wall clock; the gap to `now` exposes machine suspension. */
  wall?: () => number;
}) {
  const now = options.now ?? monotonicNow;
  const wall = options.wall ?? Date.now;
  const profiler = options.profiler ?? inspectorProfile;
  const profilesEnabled = options.profilesEnabled ?? (() => stallProfilesEnabled);
  let last = now();
  let lastWall = wall();
  let completedAtTick = completedRpcs;
  let lastStall: number | undefined;
  let profilePending = false;
  let lastWarn: number | undefined;
  let suppressed = 0;
  let maxLag = 0;
  let recent: number[] = [];
  let lastProfile: number | undefined;
  let profiling = false;

  const saveProfile = async (dir: string) => {
    const document = await profiler(PROFILE_MS);
    const file = `stall-${new Date().toISOString().replace(/[:.]/g, "-")}.cpuprofile`;
    await writeFileAtomic(join(dir, file), document);
    const old = (await readdir(dir)).filter((name) => PROFILE_FILE.test(name)).sort();
    await Promise.all(
      old
        .slice(0, Math.max(0, old.length - PROFILES_KEPT))
        .map((name) => rm(join(dir, name), { force: true })),
    );
    return file;
  };

  const tick = () => {
    const at = now();
    const wallAt = wall();
    const elapsed = elapsedSince(last, at);
    const wallElapsed = wallAt - lastWall;
    const completedBefore = completedAtTick;
    completedAtTick = completedRpcs;
    last = at;
    lastWall = wallAt;
    const lag = elapsed - TICK_MS;
    const settled = takeFinished();
    // The monotonic clock stands still while the machine sleeps (macOS/Linux), the wall clock
    // does not; on Windows both advance and the pause threshold below handles it.
    if (wallElapsed - elapsed > SUSPEND_DRIFT_MS) {
      options.log.info("Host resumed after suspend", { wallGapMs: Math.round(wallElapsed) });
      return;
    }
    if (lag >= PAUSE_MS) {
      options.log.info("Host paused (likely sleep or debugger)", { gapMs: Math.round(elapsed) });
      return;
    }
    if (lag < STALL_MS) {
      // Profiling starts only on a quiet tick: `Profiler.start` freezes the thread itself.
      if (
        profilePending &&
        (lastStall === undefined || elapsedSince(lastStall, at) >= PROFILE_IDLE_MS)
      ) {
        // The wave may be long gone by now: profile only if it still counts, and only once.
        recent = recent.filter((time) => elapsedSince(time, at) < PROFILE_WINDOW_MS);
        profilePending = false;
        if (recent.length >= PROFILE_AFTER_STALLS) startProfile(at);
      }
      return;
    }
    maxLag = Math.max(maxLag, lag);
    lastStall = at;
    recent = [...recent.filter((time) => elapsedSince(time, at) < PROFILE_WINDOW_MS), at];
    if (lastWarn !== undefined && elapsedSince(lastWarn, at) < WARN_EVERY_MS) suppressed++;
    else {
      const slow = [...inflight.values()]
        .map((entry) => ({
          method: entry.method,
          ageMs: Math.round(elapsedSince(entry.startedAt, at)),
        }))
        .filter((entry) => entry.ageMs > lag)
        .sort((a, b) => b.ageMs - a.ageMs)
        .slice(0, INFLIGHT_REPORTED);
      options.log.warn("event loop stalled", {
        lagMs: Math.round(lag),
        recentStalls: recent.length,
        rpcCompleted: completedRpcs - completedBefore,
        ...(slow.length
          ? { inflight: slow.map((entry) => `${entry.method} ${entry.ageMs}ms`).join(", ") }
          : {}),
        ...(settled.length
          ? { finished: settled.map((entry) => `${entry.method} ${entry.ms}ms`).join(", ") }
          : {}),
        ...(suppressed ? { suppressed } : {}),
      });
      lastWarn = at;
      suppressed = 0;
    }
    if (recent.length >= PROFILE_AFTER_STALLS) profilePending = true;
  };
  const startProfile = (at: number) => {
    const dir = options.profileDir;
    if (
      !dir ||
      !profilesEnabled() ||
      profiling ||
      (lastProfile !== undefined && elapsedSince(lastProfile, at) < PROFILE_EVERY_MS)
    )
      return;
    profiling = true;
    lastProfile = at;
    void saveProfile(dir)
      .then((file) => options.log.warn("stall profile saved", { file }))
      .catch(() => options.log.warn("stall profile failed"))
      .finally(() => {
        profiling = false;
      });
  };
  const timer = setInterval(tick, TICK_MS);
  timer.unref();
  return {
    /** Longest stall since the previous call, for the periodic health line. */
    takeMaxLagMs() {
      const value = Math.round(maxLag);
      maxLag = 0;
      return value;
    },
    stop() {
      clearInterval(timer);
    },
  };
}
