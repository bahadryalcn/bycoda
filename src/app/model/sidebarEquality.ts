import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import type { LiveAgent } from "../../features/sessions/model/liveAgents";

export type WorktreeTabStats = ReadonlyMap<string, { tabs: number; busy: boolean }>;

function plainEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every(
    (key) =>
      key in b &&
      plainEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/** Every field Sidebar reads. Rows synthesised from a live session
 * (`createdAt` 0) are stamped with `Date.now()` on every call, so their
 * `updatedAt` is compared by the minute: relative-time labels stay right
 * without a new list per streamed frame. */
function sessionSummaryEqual(a: SessionSummary, b: SessionSummary): boolean {
  if (a === b) return true;
  const sameUpdatedAt =
    a.createdAt === 0 && b.createdAt === 0
      ? Math.floor(a.updatedAt / 60_000) === Math.floor(b.updatedAt / 60_000)
      : a.updatedAt === b.updatedAt;
  return (
    a.id === b.id &&
    a.issue === b.issue &&
    a.orchestrationLeadId === b.orchestrationLeadId &&
    a.cwd === b.cwd &&
    a.harness === b.harness &&
    a.model === b.model &&
    a.runtimeMode === b.runtimeMode &&
    a.title === b.title &&
    a.providerSessionId === b.providerSessionId &&
    a.branch === b.branch &&
    a.worktreeCwd === b.worktreeCwd &&
    a.worktreeRemoved === b.worktreeRemoved &&
    a.repo === b.repo &&
    a.additions === b.additions &&
    a.deletions === b.deletions &&
    a.createdAt === b.createdAt &&
    sameUpdatedAt &&
    a.archived === b.archived &&
    a.pinned === b.pinned &&
    a.draft === b.draft &&
    a.automationId === b.automationId &&
    plainEqual(a.linkedWorkItem, b.linkedWorkItem) &&
    plainEqual(a.orchestration, b.orchestration)
  );
}

export function sessionSummariesEqual(
  a: readonly SessionSummary[],
  b: readonly SessionSummary[],
): boolean {
  if (a === b) return true;
  return a.length === b.length && a.every((row, index) => sessionSummaryEqual(row, b[index]));
}

export function liveAgentsEqual(a: readonly LiveAgent[], b: readonly LiveAgent[]): boolean {
  if (a === b) return true;
  return (
    a.length === b.length &&
    a.every((agent, index) => {
      const other = b[index];
      return (
        agent.id === other.id &&
        agent.cwd === other.cwd &&
        agent.title === other.title &&
        agent.harness === other.harness &&
        agent.activity === other.activity &&
        agent.startedAt === other.startedAt &&
        agent.durationMs === other.durationMs &&
        agent.needsApproval === other.needsApproval &&
        agent.inputKind === other.inputKind &&
        agent.done === other.done &&
        agent.issue === other.issue &&
        agent.ownerWindowLabel === other.ownerWindowLabel
      );
    })
  );
}

export function worktreeTabStatsEqual(a: WorktreeTabStats, b: WorktreeTabStats): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [key, stats] of a) {
    const other = b.get(key);
    if (!other || other.tabs !== stats.tabs || other.busy !== stats.busy) {
      return false;
    }
  }
  return true;
}

export function stringArraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
