import type {
  WorkspaceCreationProgress,
  WorkspaceCreationStage,
  WorkspaceCreationStageId,
} from "../workspaces/workspace-contracts";
import type { WorkspaceCreationProgressRegistry } from "../workspaces/workspace-service-contracts";

const STAGE_IDS: readonly WorkspaceCreationStageId[] = [
  "fetch",
  "checkout",
  "submodules",
  "setup",
  "agent",
];
/** Finished snapshots stay pollable this long so a late status poll still sees the outcome. */
const PROGRESS_TTL_MS = 10 * 60_000;

type Entry = { progress: WorkspaceCreationProgress; abort: AbortController; endedAt?: number };
const NOT_FOUND = "Workspace creation progress not found";

/** In-memory progress map; mirrors the bootstrap status/cancel pattern. Owned by the creation package. */
export function createWorkspaceCreationProgress(
  now: () => number = Date.now,
): WorkspaceCreationProgressRegistry {
  const entries = new Map<string, Entry>();
  const owners = new Map<string, { owner: string; at: number }>();
  const sweep = () => {
    for (const [id, entry] of entries)
      if (entry.endedAt !== undefined && now() - entry.endedAt > PROGRESS_TTL_MS) {
        entries.delete(id);
        owners.delete(id);
      }
    for (const [id, bound] of owners)
      if (!entries.has(id) && now() - bound.at > PROGRESS_TTL_MS) owners.delete(id);
  };
  const entry = (progressId: string, owner?: string): Entry => {
    sweep();
    const found = entries.get(progressId);
    const bound = owners.get(progressId);
    // Someone else's id looks exactly like an unknown one.
    // An id nobody bound is not reachable by any client either.
    if (!found || (owner !== undefined && bound?.owner !== owner)) throw new Error(NOT_FOUND);
    return found;
  };
  return {
    bindOwner(progressId, owner) {
      sweep();
      const bound = owners.get(progressId);
      if (bound && bound.owner !== owner)
        throw new Error("Workspace creation progress id is in use");
      owners.set(progressId, { owner, at: now() });
    },
    complete(progressId, stages) {
      const current = entry(progressId);
      if (current.progress.phase !== "running") return false;
      for (const stage of stages ?? []) {
        const index = current.progress.stages.findIndex((existing) => existing.id === stage.id);
        if (index >= 0) current.progress.stages[index] = stage;
      }
      current.progress.phase = "done";
      current.endedAt = now();
      return true;
    },
    create(progressId) {
      sweep();
      if (entries.get(progressId)?.progress.phase === "running")
        throw new Error("Workspace creation is already running for this progress id");
      const abort = new AbortController();
      entries.set(progressId, {
        abort,
        progress: {
          progressId,
          phase: "running",
          stages: STAGE_IDS.map((id): WorkspaceCreationStage => ({ id, status: "pending" })),
        },
      });
      return { signal: abort.signal };
    },
    update(progressId, change) {
      const current = entry(progressId);
      if (current.progress.phase !== "running") return;
      for (const stage of change.stages ?? []) {
        const index = current.progress.stages.findIndex((existing) => existing.id === stage.id);
        if (index >= 0) current.progress.stages[index] = stage;
      }
      if (change.phase) {
        current.progress.phase = change.phase;
        if (change.phase !== "running") current.endedAt = now();
      }
    },
    get: (progressId, owner) => structuredClone(entry(progressId, owner).progress),
    cancel(progressId, owner) {
      const current = entry(progressId, owner);
      if (current.progress.phase === "running") {
        current.progress.phase = "cancelled";
        current.endedAt = now();
        current.abort.abort();
      }
      return structuredClone(current.progress);
    },
  };
}

/** The Host-wide registry used by the RPC routes and `workspaces.prepare`. */
export const workspaceCreationProgress = createWorkspaceCreationProgress();
