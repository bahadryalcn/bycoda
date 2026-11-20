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
}) {
  const now = options.now ?? monotonicNow;
  const profiler = options.profiler ?? inspectorProfile;
  const profilesEnabled = options.profilesEnabled ?? (() => stallProfilesEnabled);
  let last = now();
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
    const lag = elapsedSince(last, at) - TICK_MS;
    last = at;
    if (lag < STALL_MS) return;
    maxLag = Math.max(maxLag, lag);
    recent = [...recent.filter((time) => elapsedSince(time, at) < PROFILE_WINDOW_MS), at];
    if (lastWarn !== undefined && elapsedSince(lastWarn, at) < WARN_EVERY_MS) suppressed++;
    else {
      options.log.warn("event loop stalled", {
        lagMs: Math.round(lag),
        recentStalls: recent.length,
        ...(suppressed ? { suppressed } : {}),
      });
      lastWarn = at;
      suppressed = 0;
    }
    const dir = options.profileDir;
    if (
      !dir ||
      !profilesEnabled() ||
      profiling ||
      recent.length < PROFILE_AFTER_STALLS ||
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
