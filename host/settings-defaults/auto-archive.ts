import type { AgentDefaults } from "../../src/features/tasks/model/hostSettings";
import type { HostSession } from "../../src/features/connections/model/protocol";
import { sessionNeedsInput } from "../../src/features/sessions/model/session";
import type { HostEngine } from "../engine";
import type { HostLimits } from "../limits";
import { hasMergedArchivePullRequest } from "./pull-request-links";
import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";
import { withTimeout } from "../../src/shared/lib/withTimeout";

export type ArchiveCandidate = {
  running: boolean;
  archived: boolean;
  pinned: boolean;
  draft: boolean | undefined;
  needsInput: boolean;
  queued: boolean;
  lastActivityAt: number;
  merged: boolean;
};
/** Either enabled policy may select a session; safety exclusions always win. */
export function shouldAutoArchive(
  value: ArchiveCandidate,
  settings: AgentDefaults,
  now: number,
): boolean {
  if (
    value.running ||
    value.archived ||
    value.pinned ||
    value.draft !== false ||
    value.needsInput ||
    value.queued
  )
    return false;
  return (
    (settings.archiveMergedSessions && value.merged) ||
    (settings.archiveInactiveDays > 0 &&
      Number.isFinite(value.lastActivityAt) &&
      value.lastActivityAt > 0 &&
      value.lastActivityAt <= now - settings.archiveInactiveDays * 86_400_000)
  );
}
function candidate(
  value: HostSession,
  queued: boolean,
  merged: boolean,
  running: boolean,
  clientDraft: boolean | undefined,
): ArchiveCandidate {
  return {
    running: running || value.status !== "idle" || value.session.busy === true,
    archived: value.archived === true,
    pinned: value.pinned === true,
    draft:
      !!value.session.composerSeed ||
      value.session.blocks.some(
        (block) => block.draft === true || block.followUpDelivery === "pending",
      ) ||
      clientDraft,
    needsInput:
      sessionNeedsInput(value.session) ||
      !!value.session.pendingOwnerApproval ||
      !!value.session.submittedQuestions?.length,
    queued,
    lastActivityAt: value.lastActivityAt ?? value.updatedAt,
    merged,
  };
}

/** Attach tick to the existing hourly account-platform loop. Never creates another timer. */
export function createDefaultsAutoArchive(dependencies: {
  engine: HostEngine;
  limits: HostLimits;
  queued(id: string): Promise<boolean>;
  running(id: string): Promise<boolean>;
  /**
   * False requires authoritative client draft clearance; unknown/missing protects the session.
   * `devices` is the paired-device list resolved once for the whole pass.
   */
  hasUnsentDraft?(id: string, windowMs: number, devices?: string[]): Promise<boolean | undefined>;
  /** Paired devices, read once per pass instead of once per candidate session. */
  draftDevices?(): Promise<string[]>;
  now?: () => number;
  /** Budget for one session: lock wait, transcript read and archive write. */
  deadlineMs?: number;
  /** Budget for one pass; the next pass resumes after the last session it reached. */
  passDeadlineMs?: number;
}) {
  let flight: Promise<number> | undefined;
  // Pass-to-pass cursor: a pass that ran out of budget resumes here so later projects are not starved.
  let resumeAt: string | undefined;
  const now = dependencies.now ?? Date.now;
  const sessionDeadlineMs = dependencies.deadlineMs ?? 10_000;
  const passDeadlineMs = dependencies.passDeadlineMs ?? 60_000;
  async function run() {
    // Fail closed: without a client draft authority port nothing is ever archived automatically.
    if (!dependencies.hasUnsentDraft) return 0;
    const settings = (await dependencies.limits.settings()).agentDefaults;
    if (!settings || (!settings.archiveMergedSessions && settings.archiveInactiveDays === 0))
      return 0;
    const startedAt = monotonicNow();
    const store = dependencies.engine.store;
    const cutoff =
      settings.archiveInactiveDays > 0 ? now() - settings.archiveInactiveDays * 86_400_000 : 0;
    // Cheap summary prefilter: no transcript is loaded for a session that cannot qualify.
    const rows: { key: string; id: string; stale: boolean }[] = [];
    for (const project of await store.projects()) {
      for (const row of await store.summaries(project.id)) {
        if (row.archived || row.pinned || row.status !== "idle" || row.needsInput || row.draft)
          continue;
        const activity = row.lastActivityAt ?? row.updatedAt;
        const stale = Number.isFinite(activity) && activity > 0 && activity <= cutoff;
        if (!stale && !settings.archiveMergedSessions) continue;
        rows.push({ key: `${project.id}\u0000${row.id}`, id: row.id, stale });
      }
    }
    const resumeIndex = resumeAt === undefined ? -1 : rows.findIndex((row) => row.key === resumeAt);
    resumeAt = undefined;
    const ordered =
      resumeIndex > 0 ? [...rows.slice(resumeIndex), ...rows.slice(0, resumeIndex)] : rows;
    let devices: Promise<string[] | undefined> | undefined;
    let count = 0;
    let failure: unknown;
    let reached = 0;
    for (const row of ordered) {
      // Every pass reaches at least one session, so a tiny budget still makes progress.
      if (reached > 0 && elapsedSince(startedAt) >= passDeadlineMs) {
        resumeAt = row.key;
        break;
      }
      reached++;
      // One slow or failing session spends only its own budget; the rest of the pass continues.
      const signal = AbortSignal.timeout(sessionDeadlineMs);
      try {
        // A session that is not inactive qualifies only by merged PR: one indexed lookup, no transcript.
        if (!row.stale && !(await hasMergedArchivePullRequest(store, row.id))) continue;
        // Order eligibility with sends and flush the live session before reading its safeguards.
        const write = dependencies.engine.sessionStoreWrite(row.id, async () => {
          signal.throwIfAborted();
          const value = await store.session(row.id, signal);
          const queued = await dependencies.queued(row.id);
          const running = await dependencies.running(row.id);
          // Merged-only archiving requires a report within the hourly archive window.
          const windowMs = (settings.archiveInactiveDays || 1 / 24) * 86_400_000;
          devices ??= (dependencies.draftDevices?.() ?? Promise.resolve(undefined)).catch(
            () => undefined,
          );
          const clientDraft = await dependencies.hasUnsentDraft?.(row.id, windowMs, await devices);
          const merged =
            settings.archiveMergedSessions && (await hasMergedArchivePullRequest(store, row.id));
          if (
            !shouldAutoArchive(
              candidate(value, queued, merged, running, clientDraft),
              settings,
              now(),
            )
          )
            return;
          signal.throwIfAborted();
          await store.updateSession(row.id, { archived: true }, value.authorityGeneration);
          count++;
        });
        // The write keeps running after a timeout, but its aborted signal blocks the archive.
        await withTimeout(write, sessionDeadlineMs, "Session automatic archive");
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure !== undefined) throw failure;
    return count;
  }
  return {
    tick(): Promise<number> {
      if (!flight)
        flight = run().finally(() => {
          flight = undefined;
        });
      // Keep the physical flight held after observer timeout; aborted work cannot archive later candidates.
      return withTimeout(flight, passDeadlineMs + sessionDeadlineMs, "Session automatic archive");
    },
  };
}
