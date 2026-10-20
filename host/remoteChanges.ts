import { randomUUID } from "node:crypto";
import { ChangeSignal } from "./changeSignal";
import { forEachConcurrent } from "../src/shared/lib/concurrent";
import type { HostSessionSummary, SessionSync } from "../src/features/connections/model/protocol";

export type SessionRef = {
  sessionId: string;
  revision: number;
  deleted?: boolean;
  sync?: SessionSync;
};
export type ProjectRef = {
  projectId: string;
  etag: string;
  base?: string;
  sessions?: HostSessionSummary[];
  upserts?: HostSessionSummary[];
  removed?: string[];
};
export type RemoteChangesInput = {
  inlineSync?: boolean;
  instanceId?: string;
  sessions: { sessionId: string; revision: number }[];
  projects: { projectId: string; known?: string }[];
  tasksKnown?: string;
  git?: { cwd: string; known?: string }[];
  waitMs?: number;
};
export type GitRef = {
  cwd: string;
  etag: string;
  index: boolean;
  refs: boolean;
  watching: boolean;
};
export type RemoteChangesValue = {
  instanceId: string;
  reset: boolean;
  sessions: SessionRef[];
  projects: ProjectRef[];
  tasks?: { etag: string };
  git?: GitRef[];
};

/** One bounded metadata poll for a set of session and project cursors. */
export class RemoteChanges {
  constructor(private readonly signal = new ChangeSignal()) {}
  readonly instanceId = randomUUID();
  private active = 0;
  private sessionCache = new Map<string, { at: number; revision: number | undefined }>();
  private projectBaselines = new Map<string, Map<string, HostSessionSummary[]>>();
  private projectReads = new Map<
    string,
    Promise<{ etag: string; sessions: HostSessionSummary[] }>
  >();

  async read(
    input: RemoteChangesInput,
    readSession: (id: string) => number | undefined,
    readProject: (id: string) => Promise<{ etag: string; sessions: HostSessionSummary[] }>,
    cancelled: () => boolean = () => false,
    readTasks?: () => Promise<string>,
    readGit?: (cwd: string) => Promise<{ etag: string; watching: boolean }>,
    recheckMs: () => number = () => 1000,
  ): Promise<RemoteChangesValue> {
    if (!Array.isArray(input.sessions) || input.sessions.length > 64)
      throw new Error("At most 64 session subscriptions are allowed");
    if (!Array.isArray(input.projects) || input.projects.length > 32)
      throw new Error("At most 32 project subscriptions are allowed");
    const sessions = input.sessions.map((entry) => {
      if (
        !entry ||
        typeof entry.sessionId !== "string" ||
        !entry.sessionId ||
        !Number.isSafeInteger(entry.revision) ||
        entry.revision < 0
      )
        throw new Error("Invalid session subscription");
      return entry;
    });
    const projects = input.projects.map((entry) => {
      if (
        !entry ||
        typeof entry.projectId !== "string" ||
        !entry.projectId ||
        (entry.known !== undefined && typeof entry.known !== "string")
      )
        throw new Error("Invalid project subscription");
      return entry;
    });
    if (input.git !== undefined && !Array.isArray(input.git))
      throw new Error("Invalid git subscriptions");
    if ((input.git?.length ?? 0) > 32) throw new Error("At most 32 git subscriptions are allowed");
    const gitCursors = (input.git ?? []).map((entry) => {
      if (
        !entry ||
        typeof entry.cwd !== "string" ||
        !entry.cwd ||
        (entry.known !== undefined && typeof entry.known !== "string")
      )
        throw new Error("Invalid git subscription");
      return entry;
    });
    const reset = input.instanceId !== this.instanceId;
    if (this.cacheVersion !== this.signal.version) {
      this.sessionCache.clear();
      this.cacheVersion = this.signal.version;
    }
    const readCachedSession = (id: string) => {
      const now = Date.now();
      const cached = this.sessionCache.get(id);
      if (cached && now - cached.at < 200) return cached.revision;
      const revision = readSession(id);
      this.sessionCache.set(id, { at: now, revision });
      while (this.sessionCache.size > 4096)
        this.sessionCache.delete(this.sessionCache.keys().next().value!);
      return revision;
    };
    const changed = async (): Promise<RemoteChangesValue> => {
      const sessionValues = sessions.flatMap(({ sessionId, revision }) => {
        const current = readCachedSession(sessionId);
        if (current === undefined)
          return reset
            ? [{ sessionId, revision: 0, deleted: true }]
            : [{ sessionId, revision, deleted: true }];
        return reset || current !== revision ? [{ sessionId, revision: current }] : [];
      });
      const projectValues: ProjectRef[] = [];
      // Independent project reads may touch transcripts. Bound IO concurrency
      // while keeping the response in subscription order.
      const projectSnapshots = new Map<string, Awaited<ReturnType<typeof readProject>>>();
      await forEachConcurrent(
        [...new Set(projects.map(({ projectId }) => projectId))],
        4,
        async (projectId) => {
          let pending = this.projectReads.get(projectId);
          if (!pending) {
            pending = readProject(projectId).finally(() => {
              if (this.projectReads.get(projectId) === pending) this.projectReads.delete(projectId);
            });
            this.projectReads.set(projectId, pending);
          }
          projectSnapshots.set(projectId, await pending);
        },
      );
      for (const { projectId, known } of projects) {
        const value = projectSnapshots.get(projectId)!;
        this.rememberProject(projectId, value.etag, value.sessions);
        if (reset || known !== value.etag) {
          const previous =
            known === undefined ? undefined : this.projectBaselines.get(projectId)?.get(known);
          if (
            !reset &&
            known !== undefined &&
            previous &&
            previous.length <= 512 &&
            value.sessions.length <= 512
          ) {
            if (
              previous.every((row) => this.summaryId(row) !== undefined) &&
              value.sessions.every((row) => this.summaryId(row) !== undefined)
            ) {
              const before = new Map<string, HostSessionSummary>(
                previous.map((row) => [this.summaryId(row)!, row]),
              );
              const after = new Map<string, HostSessionSummary>(
                value.sessions.map((row) => [this.summaryId(row)!, row]),
              );
              const upserts = [...after]
                .filter(([id, row]) => {
                  const old = before.get(id);
                  return old === undefined || JSON.stringify(old) !== JSON.stringify(row);
                })
                .map(([, row]) => row);
              const removed = [...before.keys()].filter((id) => !after.has(id));
              projectValues.push({
                projectId,
                etag: value.etag,
                base: known,
                upserts,
                removed,
              });
              continue;
            }
          }
          projectValues.push({
            projectId,
            etag: value.etag,
            ...(known === undefined ? {} : { base: known }),
            sessions: value.sessions,
          });
        }
      }
      let tasks: { etag: string } | undefined;
      if (input.tasksKnown !== undefined && readTasks) {
        const etag = await readTasks();
        if (input.tasksKnown !== etag) tasks = { etag };
      }
      const gitValues: GitRef[] = [];
      if (readGit) {
        for (const { cwd, known } of gitCursors) {
          const current = await readGit(cwd);
          if (!current.watching) {
            // Reported once; the client then answers with known "".
            if (known !== "")
              gitValues.push({
                cwd,
                etag: "",
                index: false,
                refs: false,
                watching: false,
              });
            continue;
          }
          if (!reset && known === current.etag) continue;
          const before = parseGitEtag(known);
          const now = parseGitEtag(current.etag);
          gitValues.push({
            cwd,
            etag: current.etag,
            index: !!before && !!now && before[0] !== now[0],
            refs: !!before && !!now && before[1] !== now[1],
            watching: true,
          });
        }
      }
      return {
        instanceId: this.instanceId,
        reset,
        sessions: sessionValues,
        projects: projectValues,
        ...(tasks ? { tasks } : {}),
        ...(gitValues.length ? { git: gitValues } : {}),
      };
    };
    let version = this.signal.version;
    const first = await changed();
    if (
      reset ||
      first.sessions.length ||
      first.projects.length ||
      first.tasks ||
      first.git ||
      cancelled()
    )
      return first;
    if (this.active >= 64 || !(Number(input.waitMs) > 0)) return first;
    this.active++;
    const deadline = Date.now() + Math.min(10_000, Math.max(0, Number(input.waitMs) || 0));
    let latest = first;
    try {
      while (!cancelled() && Date.now() < deadline) {
        await this.signal.wait(Math.min(deadline, Date.now() + recheckMs()), cancelled, version);
        version = this.signal.version;
        this.sessionCache.clear();
        latest = await changed();
        if (latest.sessions.length || latest.projects.length || latest.tasks || latest.git)
          return latest;
      }
      return latest;
    } finally {
      this.active--;
    }
  }

  private cacheVersion = -1;

  private summaryId(value: unknown): string | undefined {
    return value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string"
      ? (value as { id: string }).id
      : undefined;
  }

  private rememberProject(projectId: string, etag: string, sessions: HostSessionSummary[]) {
    if (sessions.length > 512 || sessions.some((session) => this.summaryId(session) === undefined))
      return;
    let versions = this.projectBaselines.get(projectId);
    if (!versions) {
      versions = new Map();
      this.projectBaselines.set(projectId, versions);
    }
    versions.delete(etag);
    versions.set(etag, sessions);
    while (versions.size > 4) versions.delete(versions.keys().next().value!);
    while (this.projectBaselines.size > 32)
      this.projectBaselines.delete(this.projectBaselines.keys().next().value!);
  }
}

/** "<indexRev>.<refsRev>" as numbers; undefined when malformed. */
function parseGitEtag(etag: string | undefined): [number, number] | undefined {
  const match = etag === undefined ? null : /^(\d+)\.(\d+)$/.exec(etag);
  return match ? [Number(match[1]), Number(match[2])] : undefined;
}
