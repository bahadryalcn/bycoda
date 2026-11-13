import { createHash } from "node:crypto";
import type { HostStore } from "../../store";
import type { AssistantActivity } from "../../../src/shared/model/host-contracts/assistant";
import type {
  RoomManagementAdmission,
  RoomManagementCall,
  RoomManagementResult,
} from "./assistant-management-turn";
import type { AssistantPorts } from "../service";
import type { NativeLibraryProof } from "../native/assistant-native-library-proof";
import { truncateGraphemes } from "../../../src/shared/lib/text/truncate";

type Action = {
  identity: string;
  digest: string;
  phase: "started" | "result";
  createdAt: number;
  threadId?: string;
  jobId?: string;
  supervisionId?: string;
  projectId?: string;
  accountId?: string;
  family: string;
  action: string;
  target: string;
  outcome: string;
  projects: { projectId: string; cwd: string }[];
  accounts: { accountId: string; version: string }[];
  nativeRequired?: boolean;
  nativeProofs?: NativeLibraryProof[];
};

function outcome(value: unknown, depth = 0): string {
  if (depth >= 4) return "unknown";
  if (!value || typeof value !== "object") return "completed";
  const result = value as Record<string, unknown>;
  if (result.state === "completed" && result.result && typeof result.result === "object")
    return outcome(result.result, depth + 1);
  if (result.approved === false) return "refused";
  if (result.ok === false) return "failed";
  const status = result.state ?? result.status;
  if (status === "uncertain") return "unknown";
  if (status === "planning" || status === "queued" || status === "todo") return "pending";
  if (status === "verifying") return "running";
  if (status === "done" || status === "succeeded") return "completed";
  if (result.requested === true) return "submitted";
  return typeof status === "string" &&
    [
      "completed",
      "submitted",
      "unknown",
      "failed",
      "cancelled",
      "pending",
      "running",
      "waiting",
      "accepted",
      "refused",
    ].includes(status)
    ? status
    : "completed";
}

/** Append-only actual-effect journal. No prompts, payload text or returned private data are stored. */
export class AssistantActionJournal {
  readonly ready: Promise<void>;
  constructor(
    private readonly store: HostStore,
    private readonly now: () => number,
  ) {
    this.ready = store.ready.then(() =>
      store.db.scope(() =>
        store.db.exec(
          "CREATE TABLE IF NOT EXISTS assistant_action_journal(identity TEXT NOT NULL, phase TEXT NOT NULL, digest TEXT NOT NULL, created_at INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(identity,phase)); CREATE TABLE IF NOT EXISTS assistant_action_journal_clears(scope TEXT NOT NULL, through_rowid INTEGER NOT NULL);",
        ),
      ),
    );
  }
  private async append(action: Action) {
    await this.ready;
    await this.store.transaction(async () => {
      const previous = await this.store.db
        .prepare("SELECT digest FROM assistant_action_journal WHERE identity=? LIMIT 1")
        .get(action.identity);
      if (previous && previous.digest !== action.digest)
        throw new Error("Assistant action identity was reused with another operation.");
      await this.store.db
        .prepare(
          "INSERT OR IGNORE INTO assistant_action_journal(identity,phase,digest,created_at,value) VALUES(?,?,?,?,?)",
        )
        .run(
          action.identity,
          action.phase,
          action.digest,
          action.createdAt,
          JSON.stringify(action),
        );
    }, "critical");
  }
  async run(
    call: RoomManagementCall,
    environmentId: string,
    effect: () => Promise<RoomManagementResult>,
  ): Promise<RoomManagementResult> {
    const project = call.projectId
      ? (await this.store.projects()).find((project) => project.id === call.projectId)
      : undefined;
    const projects = project ? [{ projectId: project.id, cwd: project.cwd }] : [];
    const identity = createHash("sha256")
      .update(JSON.stringify([environmentId, call.threadId, call.requestId]))
      .digest("hex");
    const target = truncateGraphemes(
      [
        call.projectId ?? (call.accountId ? "account" : "application"),
        call.input.taskId ??
          call.input.goalId ??
          call.input.automationId ??
          call.input.workspaceId ??
          call.input.noteId ??
          (call.projectId ? call.input.path : undefined),
      ]
        .filter((value) => typeof value === "string")
        .join(" / "),
      300,
    );
    const base = {
      identity,
      digest: createHash("sha256")
        .update(
          JSON.stringify([call.family, call.action, call.projectId, call.accountId, call.input]),
        )
        .digest("hex"),
      threadId: call.threadId,
      ...(call.projectId ? { projectId: call.projectId } : {}),
      ...(call.accountId ? { accountId: call.accountId } : {}),
      family: call.family,
      action: call.action,
      target: target.length <= 300 ? target : (call.projectId ?? "application"),
      nativeRequired: call.input.nativeLibrary === true || call.input.source === "native-session",
    };
    await this.append({
      ...base,
      phase: "started",
      outcome: "started",
      createdAt: this.now(),
      projects,
      accounts: [],
    });
    let result: RoomManagementResult;
    try {
      result = await effect();
    } catch (error) {
      // An exception after entering the effect is not proof that nothing happened.
      await this.append({
        ...base,
        phase: "result",
        outcome: "unknown",
        createdAt: this.now(),
        projects,
        accounts: [],
      });
      throw error;
    }
    await this.append({
      ...base,
      phase: "result",
      outcome: outcome(result.value),
      createdAt: this.now(),
      projects: result.contributorProjects ?? projects,
      accounts: result.contributorAccounts ?? [],
      nativeProofs: result.contributorNativeProofs,
    });
    return result;
  }
  async runJob<T>(
    jobId: string,
    projectIds: string[],
    target: string,
    effect: () => Promise<T>,
  ): Promise<T> {
    return this.runAutonomous(
      { operationId: `${jobId}:goals.create`, action: "goals.create", jobId, projectIds, target },
      effect,
    );
  }
  async runAutonomous<T>(
    input: {
      operationId: string;
      action: string;
      target: string;
      jobId?: string;
      supervisionId?: string;
      projectIds: string[];
      payload?: unknown;
    },
    effect: () => Promise<T>,
  ): Promise<T> {
    const { projectIds, target } = input;
    const known = await this.store.projects();
    const projects = projectIds.flatMap((id) => {
      const project = known.find((project) => project.id === id);
      return project ? [{ projectId: id, cwd: project.cwd }] : [];
    });
    if (projects.length !== projectIds.length)
      throw new Error("Assistant job journal project identity is unavailable.");
    const identity = createHash("sha256")
      .update(
        JSON.stringify([
          this.store.environmentId,
          "autonomous",
          input.jobId,
          input.supervisionId,
          input.operationId,
          input.action,
          target,
        ]),
      )
      .digest("hex");
    const base = {
      identity,
      digest: createHash("sha256")
        .update(JSON.stringify([input.jobId, input.supervisionId, projects, target, input.payload]))
        .digest("hex"),
      ...(input.jobId ? { jobId: input.jobId } : {}),
      ...(input.supervisionId ? { supervisionId: input.supervisionId } : {}),
      family: "conversation",
      action: input.action,
      target,
      projects,
      accounts: [],
    };
    await this.append({ ...base, phase: "started", outcome: "started", createdAt: this.now() });
    try {
      const value = await effect();
      await this.append({
        ...base,
        phase: "result",
        outcome: outcome(value),
        createdAt: this.now(),
      });
      return value;
    } catch (error) {
      await this.append({ ...base, phase: "result", outcome: "unknown", createdAt: this.now() });
      throw error;
    }
  }
  /** Clear the view without rewriting or deleting actual effect evidence. */
  async clear(jobId?: string): Promise<void> {
    await this.ready;
    await this.store.transaction(async () => {
      const row = await this.store.db
        .prepare("SELECT COALESCE(MAX(rowid),0) AS last_row FROM assistant_action_journal")
        .get();
      await this.store.db
        .prepare("INSERT INTO assistant_action_journal_clears(scope,through_rowid) VALUES(?,?)")
        .run(jobId ? `job:${jobId}` : "*", Number(row?.last_row ?? 0));
    }, "critical");
  }
  async activity(
    limit: number,
    ports: AssistantPorts,
    admission?: RoomManagementAdmission,
    targetThreadId?: string,
  ): Promise<AssistantActivity[]> {
    await this.ready;
    if (!admission || !ports.withRoomResponseDisclosure) return [];
    const rows = await this.store.db
      .prepare(
        "SELECT value FROM assistant_action_journal j WHERE rowid>COALESCE((SELECT MAX(through_rowid) FROM assistant_action_journal_clears WHERE scope='*'),0) AND rowid>COALESCE((SELECT MAX(through_rowid) FROM assistant_action_journal_clears WHERE scope='job:'||json_extract(j.value,'$.jobId')),0) ORDER BY created_at DESC,identity DESC LIMIT ?",
      )
      .all(Math.min(limit * 4, 400));
    const actions = rows.map((row) => JSON.parse(String(row.value)) as Action);
    const settled = new Set(
      actions.filter((action) => action.phase === "result").map((action) => action.identity),
    );
    const visible: Action[] = [];
    for (const action of actions) {
      if (action.phase === "started" && settled.has(action.identity)) continue;
      if (!action.threadId && !targetThreadId) continue;
      const thread = await this.store.db
        .prepare("SELECT id FROM assistant_threads WHERE id=? AND deleted_at IS NULL")
        .get(action.threadId ?? targetThreadId!);
      if (!thread) continue;
      if (action.nativeRequired && !action.nativeProofs?.length) continue;
      if (
        action.accountId &&
        (!action.threadId ||
          !action.accounts.length ||
          !ports.roomAccountProofsValid ||
          !(await ports.roomAccountProofsValid(action.threadId, action.accounts)))
      )
        continue;
      if (
        (action.jobId || action.supervisionId) &&
        (
          await Promise.all(
            action.projects.map((project) => ports.manualProjectVisible?.(project.projectId)),
          )
        ).some((visible) => visible !== true)
      )
        continue;
      if (
        action.projectId &&
        (!action.projects.some((project) => project.projectId === action.projectId) ||
          !(await ports.manualProjectVisible?.(action.projectId)))
      )
        continue;
      visible.push(action);
      if (visible.length >= limit) break;
    }
    if (!visible.length) return [];
    return ports.withRoomResponseDisclosure(
      visible.map((action) => ({
        threadId: action.threadId ?? targetThreadId!,
        projects: action.projects.map((project) => project.projectId),
        accounts: action.accounts,
        projectProofs: action.projects,
        nativeProofs: action.nativeProofs,
      })),
      admission,
      async (valid) => {
        if (!valid()) throw new Error("Assistant action history source visibility changed.");
        return visible.map((action) => ({
          id: `action:${action.identity}:${action.phase}`,
          version: 0,
          createdAt: action.createdAt,
          updatedAt: action.createdAt,
          kind: `action.${action.outcome}`,
          summary: `${action.family}:${action.action} · ${action.target} · ${action.outcome}`,
          ...(action.jobId ? { jobId: action.jobId } : {}),
          ...(action.supervisionId ? { supervisionId: action.supervisionId } : {}),
          projectIds: action.projects.map((project) => project.projectId),
          operation: {
            identity: action.identity,
            threadId: action.threadId,
            tool: `${action.family}:${action.action}`,
            target: action.target,
            outcome: action.outcome,
          },
        }));
      },
    );
  }
}
