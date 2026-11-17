import type { AgentDefaults } from "../../src/features/tasks/model/hostSettings";
import type { HostSession } from "../../src/features/connections/model/protocol";
import { sessionNeedsInput } from "../../src/features/sessions/model/session";
import type { HostEngine } from "../engine";
import type { HostLimits } from "../limits";
import { hasMergedArchivePullRequest } from "./pull-request-links";
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
  /** False requires authoritative client draft clearance; unknown/missing protects the session. */
  hasUnsentDraft?(id: string): Promise<boolean | undefined>;
  now?: () => number;
  deadlineMs?: number;
}) {
  let flight: Promise<number> | undefined;
  const now = dependencies.now ?? Date.now;
  async function run() {
    const signal = AbortSignal.timeout(dependencies.deadlineMs ?? 10_000);
    // Fail closed: without a client draft authority port nothing is ever archived automatically.
    if (!dependencies.hasUnsentDraft) return 0;
    const settings = (await dependencies.limits.settings()).agentDefaults;
    if (!settings || (!settings.archiveMergedSessions && settings.archiveInactiveDays === 0))
      return 0;
    let count = 0;
    const store = dependencies.engine.store;
    for (const project of await store.projects()) {
      for (const row of await store.summaries(project.id)) {
        signal.throwIfAborted();
        if (row.archived || row.pinned || row.status !== "idle") continue;
        // Order eligibility with sends and flush the live session before reading its safeguards.
        await dependencies.engine.sessionStoreWrite(row.id, async () => {
          signal.throwIfAborted();
          const value = await store.session(row.id, signal);
          const queued = await dependencies.queued(row.id);
          const running = await dependencies.running(row.id);
          const clientDraft = await dependencies.hasUnsentDraft?.(row.id);
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
      }
    }
    return count;
  }
  return {
    tick(): Promise<number> {
      if (!flight)
        flight = run().finally(() => {
          flight = undefined;
        });
      // Keep the physical flight held after observer timeout; aborted work cannot archive later candidates.
      return withTimeout(flight, dependencies.deadlineMs ?? 10_000, "Session automatic archive");
    },
  };
}
