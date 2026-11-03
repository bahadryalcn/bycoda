import { createHash, randomUUID } from "node:crypto";
import type { HostStore } from "./store";
import type { HostSession } from "../src/features/connections/model/protocol";

import type {
  ManualSessionSource,
  ManualSessionCandidate,
  ManualSupervisionGrant,
} from "../src/shared/model/assistantManual";
export type {
  ManualSessionSource,
  ManualSessionCandidate,
  ManualSupervisionGrant,
} from "../src/shared/model/assistantManual";
export interface ManualSupervisionPorts {
  enabled(): Promise<boolean>;
  name(): Promise<string>;
  visibleProject(projectId: string): Promise<boolean>;
  now?(): number;
}
const bounded = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([key, v]) => `${JSON.stringify(key)}:${stable(v)}`)
    .join(",")}}`;
}
const digest = (value: unknown) => createHash("sha256").update(stable(value)).digest("hex");
function source(record: HostSession): ManualSessionSource {
  const session = record.session;
  return {
    projectId: record.projectId,
    executionCwd: session.worktreeCwd ?? session.cwd,
    ...(record.authorityGeneration === undefined
      ? {}
      : { authorityGeneration: record.authorityGeneration }),
    harness: session.harness,
    model: session.model,
    modelSettings: { ...session.modelSettings },
    runtimeMode: session.runtimeMode,
    ...(session.providerAccountId ? { providerAccountId: session.providerAccountId } : {}),
  };
}
/** Durable, revocable grants for explicitly selected owner conversations. These
 * records never manufacture a Goal/Task or grant control of another run owner. */
export class HostAssistantManualSessions {
  readonly ready: Promise<void>;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly store: HostStore,
    private readonly ports: ManualSupervisionPorts,
  ) {
    this.ready = (async () => {
      await store.ready;
      await store.db.scope(() =>
        store.db.exec(
          "CREATE TABLE IF NOT EXISTS assistant_manual_supervision(session_id TEXT PRIMARY KEY,id TEXT UNIQUE NOT NULL,value TEXT NOT NULL);CREATE TABLE IF NOT EXISTS assistant_manual_supervision_history(id TEXT PRIMARY KEY,value TEXT NOT NULL);",
        ),
      );
    })();
  }
  private now() {
    return this.ports.now?.() ?? Date.now();
  }
  private owner(principal: unknown) {
    if (principal !== "owner")
      throw new Error("Manual session enrollment requires the captured owner.");
  }
  private async serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      await this.ready;
      await this.store.db.checkAuthorization();
      return work();
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
  async read(sessionId: string): Promise<ManualSupervisionGrant | undefined> {
    await this.ready;
    if (!bounded(sessionId, 200)) throw new Error("Invalid session identity.");
    const row = await this.store.db
      .prepare("SELECT value FROM assistant_manual_supervision WHERE session_id=?")
      .get(sessionId);
    return row ? (JSON.parse(row.value) as ManualSupervisionGrant) : undefined;
  }
  async list(): Promise<ManualSupervisionGrant[]> {
    await this.ready;
    const rows = await this.store.db
      .prepare("SELECT value FROM assistant_manual_supervision ORDER BY session_id LIMIT 100")
      .all();
    const grants: ManualSupervisionGrant[] = [];
    for (const row of rows) {
      const grant = JSON.parse(row.value) as ManualSupervisionGrant;
      if (await this.ports.visibleProject(grant.source.projectId)) grants.push(grant);
    }
    return grants;
  }
  /** Accounting only: old grants cannot resolve an execution permission. */
  async listAllForUsage(): Promise<ManualSupervisionGrant[]> {
    await this.ready;
    const rows = await this.store.db
      .prepare(
        "SELECT value FROM (SELECT value FROM assistant_manual_supervision UNION ALL SELECT value FROM assistant_manual_supervision_history) ORDER BY json_extract(value,'$.enrolledAt') DESC LIMIT 10000",
      )
      .all();
    return rows.map((row) => JSON.parse(row.value) as ManualSupervisionGrant);
  }
  private async canonicalOwner(record: HostSession): Promise<string | undefined> {
    const management = record.session.managedBy ?? record.managedBy;
    if (management && "jobId" in management)
      return "This conversation belongs to an assistant job.";
    if (record.session.orchestrationLeadId)
      return "This conversation is an internal orchestration worker.";
    const crew = await this.store.db
      .prepare(
        "SELECT 1 FROM metadata,json_tree(metadata.value,'$.runs') AS node WHERE metadata.key='crews.v1' AND node.type='text' AND node.value=? AND node.key='coordinatorSessionId' LIMIT 1",
      )
      .get(record.session.id);
    if (crew) return "This conversation is a canonical Crew coordinator.";
    const tables = await this.store.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tasks','goals','automations','automation_runs','stewards','crew_runs','crew_run_members')",
      )
      .all();
    for (const row of tables) {
      const table = String(row.name);
      const columns = await this.store.db.prepare(`PRAGMA table_info(${table})`).all();
      if (!columns.some((column) => column.name === "value")) continue;
      const owned = await this.store.db
        .prepare(
          `SELECT 1 FROM ${table},json_tree(${table}.value) AS node WHERE node.type='text' AND node.value=? AND lower(CAST(node.key AS TEXT)) IN ('sessionid','workersessionid','reviewersessionid','previoussessionid','plannersessionid','lastsessionid') LIMIT 1`,
        )
        .get(record.session.id);
      if (owned)
        return "This conversation has a canonical task, planner, review, automation, steward or Crew owner.";
    }
    if (
      record.session.blocks.some(
        (block) => block.author && ["task", "automation", "steward"].includes(block.author.kind),
      )
    )
      return "This conversation retains a canonical unattended-run author.";
  }
  private async candidate(record: HostSession): Promise<ManualSessionCandidate> {
    const reason = await this.canonicalOwner(record),
      grant = await this.read(record.session.id);
    const sourceToken = digest({
      source: source(record),
      runId: record.runId ?? null,
      status: record.status,
      owner: reason ?? null,
    });
    return {
      sessionId: record.session.id,
      projectId: record.projectId,
      title: record.session.title.slice(0, 300),
      sourceToken,
      eligible: !reason,
      ...(reason ? { reason } : {}),
      ...(grant?.active
        ? { enrolledSourceChanged: grant.sourceToken !== digest(source(record)) }
        : {}),
    };
  }
  async listCandidates(principal: "owner"): Promise<ManualSessionCandidate[]> {
    this.owner(principal);
    await this.ready;
    await this.store.db.checkAuthorization();
    const values: ManualSessionCandidate[] = [];
    for (const project of await this.store.projects())
      if (await this.ports.visibleProject(project.id)) {
        for (const record of await this.store.sessions(project.id)) {
          values.push(await this.candidate(record));
          if (values.length >= 100) return values;
        }
      }
    return values;
  }
  async enroll(
    input: { sessionId: string; sourceToken: string; expectedVersion: number },
    principal: "owner",
  ): Promise<ManualSupervisionGrant> {
    this.owner(principal);
    return this.serial(async () => {
      if (
        !bounded(input.sessionId, 200) ||
        !/^[a-f0-9]{64}$/.test(input.sourceToken) ||
        !Number.isSafeInteger(input.expectedVersion) ||
        input.expectedVersion < 0
      )
        throw new Error("Invalid manual supervision enrollment.");
      if (!(await this.ports.enabled()))
        throw new Error(
          "Enable manual supervision and Chief autonomy before enrolling a conversation.",
        );
      return this.store.transaction(async () => {
        const current = await this.store.session(input.sessionId);
        if (!(await this.ports.visibleProject(current.projectId)))
          throw new Error("The owner cannot enroll this project.");
        const candidate = await this.candidate(current);
        if (!candidate.eligible) throw new Error(candidate.reason);
        if (candidate.sourceToken !== input.sourceToken)
          throw new Error(
            "The selected conversation changed; refresh its backend source token before enrolling.",
          );
        const old = await this.read(input.sessionId);
        if ((old?.version ?? 0) !== input.expectedVersion)
          throw new Error("Manual supervision changed; reload before enrolling.");
        if (!old?.active) {
          const count = await this.store.db
            .prepare(
              "SELECT count(*) AS n FROM assistant_manual_supervision WHERE json_extract(value,'$.active')=1",
            )
            .get();
          if (Number(count?.n ?? 0) >= 100)
            throw new Error("The assistant already has 100 active manual supervision grants.");
        }
        const grant: ManualSupervisionGrant = {
          id: randomUUID(),
          sessionId: input.sessionId,
          title: current.session.title.slice(0, 300),
          version: input.expectedVersion + 1,
          active: true,
          source: source(current),
          sourceToken: digest(source(current)),
          enrolledAt: this.now(),
          updatedAt: this.now(),
        };
        if (!(await this.ports.enabled()))
          throw new Error("Manual supervision was disabled before enrollment.");
        if (old)
          await this.store.db
            .prepare(
              "INSERT OR REPLACE INTO assistant_manual_supervision_history(id,value) VALUES(?,?)",
            )
            .run(
              old.id,
              JSON.stringify(
                old.active
                  ? {
                      ...old,
                      active: false,
                      version: old.version + 1,
                      updatedAt: this.now(),
                      revokedAt: this.now(),
                    }
                  : old,
              ),
            );
        await this.store.db
          .prepare(
            "INSERT INTO assistant_manual_supervision(session_id,id,value) VALUES(?,?,?) ON CONFLICT(session_id) DO UPDATE SET id=excluded.id,value=excluded.value",
          )
          .run(input.sessionId, grant.id, JSON.stringify(grant));
        await this.store.markAssistantManualSession(input.sessionId, grant.id);
        return grant;
      }, "critical");
    });
  }
  async revoke(
    input: { id: string; expectedVersion: number },
    principal: "owner",
  ): Promise<ManualSupervisionGrant> {
    this.owner(principal);
    return this.serial(() =>
      this.store.transaction(async () => {
        if (
          !bounded(input.id, 200) ||
          !Number.isSafeInteger(input.expectedVersion) ||
          input.expectedVersion < 1
        )
          throw new Error("Invalid manual supervision revocation.");
        const row = await this.store.db
          .prepare("SELECT value FROM assistant_manual_supervision WHERE id=?")
          .get(input.id);
        if (!row) throw new Error("Manual supervision is unavailable.");
        const grant = JSON.parse(row.value) as ManualSupervisionGrant;
        if (!(await this.ports.visibleProject(grant.source.projectId)))
          throw new Error("The owner cannot revoke this project's enrollment.");
        if (grant.version !== input.expectedVersion)
          throw new Error("Manual supervision changed; reload before revoking.");
        const next = {
          ...grant,
          version: grant.version + 1,
          active: false,
          revokedAt: this.now(),
          updatedAt: this.now(),
        };
        await this.store.db
          .prepare("UPDATE assistant_manual_supervision SET value=? WHERE id=?")
          .run(JSON.stringify(next), grant.id);
        return next;
      }, "critical"),
    );
  }
  async resolveStatus(
    supervisionId: string,
    sessionId: string,
    expectedVersion?: number,
  ): Promise<{ grant: ManualSupervisionGrant; session: HostSession; name: string }> {
    await this.ready;
    await this.store.db.checkAuthorization();
    if (!(await this.ports.enabled()))
      throw new Error("Manual supervision is disabled or Chief authority is unavailable.");
    const grant = await this.read(sessionId);
    if (
      !grant ||
      grant.id !== supervisionId ||
      !grant.active ||
      (expectedVersion !== undefined && grant.version !== expectedVersion)
    )
      throw new Error("The exact manual supervision grant was revoked or replaced.");
    if (!(await this.ports.visibleProject(grant.source.projectId)))
      throw new Error("The enrolled project's owner access is unavailable.");
    const record = await this.store.session(sessionId);
    if (digest(source(record)) !== grant.sourceToken)
      throw new Error(
        "The enrolled conversation's execution identity changed; explicit re-enrollment is required.",
      );
    const owner = await this.canonicalOwner(record);
    if (owner) throw new Error(owner);
    const name = await this.ports.name();
    if (!bounded(name, 200)) throw new Error("The assistant identity is unavailable.");
    const latest = await this.read(sessionId);
    if (
      !latest?.active ||
      latest.id !== grant.id ||
      latest.version !== grant.version ||
      !(await this.ports.enabled())
    )
      throw new Error("The manual supervision grant changed before dispatch.");
    await this.store.db.checkAuthorization();
    return { grant, session: record, name };
  }
}
