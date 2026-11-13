import { parseRemotePath } from "../../src/features/connections/model/remoteProjects";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  parseHostAutomation,
  type HostAutomation,
  type HostAutomationRun,
} from "../../src/features/automations/model/hostAutomations";
import { NativeAutomationMigrationSchema } from "../../src/shared/model/host-contracts/automations";
import type { HostStore } from "../store";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const snapshotSchema = z.object({
  automation: z
    .object({
      id: z.string(),
      cwd: z.string(),
      enabled: z.boolean(),
      nextRunAt: z.number().int().nonnegative(),
      createdAt: z.number().int().nonnegative(),
      updatedAt: z.number().int().nonnegative(),
    })
    .passthrough(),
  runs: z.array(
    z
      .object({
        id: z.string(),
        status: z.enum(["succeeded", "failed", "skipped", "cancelled"]),
        scheduledFor: z.number(),
        createdAt: z.number(),
        startedAt: z.number().optional(),
        completedAt: z.number().optional(),
        sessionId: z.string().optional(),
        error: z.string().optional(),
        trigger: z.string(),
      })
      .passthrough(),
  ),
});

/** Owner-paired migration only. Prepared imports cannot be scheduled or manually launched. */
export async function importNativeAutomation(
  store: HostStore,
  raw: Record<string, unknown>,
): Promise<HostAutomation> {
  const proof = NativeAutomationMigrationSchema.parse(raw.nativeMigration);
  if (proof.targetHostId !== store.environmentId)
    throw new Error("Automation migration belongs to another Host.");
  const snapshot = snapshotSchema.parse(JSON.parse(proof.snapshot));
  if (snapshot.automation.id !== proof.automationId)
    throw new Error("Automation migration source identity changed.");
  const source = snapshot.automation;
  const project = await store.project(String(raw.projectId ?? ""));
  const pathKey = (path: string) =>
    process.platform === "win32"
      ? path.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()
      : path.replace(/\/+$/, "");
  const remoteSource = parseRemotePath(source.cwd);
  if (remoteSource && remoteSource.environmentId !== store.environmentId)
    throw new Error("Automation source belongs to another Host.");
  if (pathKey(project.cwd) !== pathKey(remoteSource?.hostPath ?? source.cwd))
    throw new Error("Automation migration project does not match the original checkout.");
  const fingerprint = digest(proof.snapshot);
  const id = `native-${digest(proof.receipt).slice(0, 40)}`;
  if (proof.phase === "committed" && proof.hostAutomationId !== id)
    throw new Error("Committed migration names another Host automation.");
  return store.transaction(async () => {
    await store.db.exec(
      "CREATE TABLE IF NOT EXISTS automation_native_migrations (receipt TEXT PRIMARY KEY, automation_id TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL, snapshot TEXT NOT NULL, phase TEXT NOT NULL, source_automation_id TEXT NOT NULL)",
    );
    const existing = await store.db
      .prepare("SELECT * FROM automation_native_migrations WHERE receipt=?")
      .get(proof.receipt);
    const stored = await store.db.prepare("SELECT value FROM automations WHERE id=?").get(id);
    if (existing && (existing.fingerprint !== fingerprint || existing.automation_id !== id))
      throw new Error("Automation migration receipt payload changed.");
    if (existing && !stored)
      throw new Error("Prepared automation was deleted; refusing to recreate it.");
    if (!existing && stored) throw new Error("Native automation migration identity is occupied.");
    if (!existing && proof.phase !== "prepared")
      throw new Error("Import the prepared native receipt before activation.");
    if (existing?.phase === "committed") {
      if (!stored) throw new Error("Migrated automation was deleted; refusing to recreate it.");
      return JSON.parse(String(stored.value)) as HostAutomation;
    }
    const triggers = Array.isArray(source.triggers) ? source.triggers : [];
    const schedule = triggers[0] && typeof triggers[0] === "object" ? triggers[0] : {};
    const input = parseHostAutomation({
      ...source,
      ...schedule,
      id,
      projectId: raw.projectId,
      modelSettings: source.modelSettings ?? {},
      isolate:
        source.workspaceMode === "worktree"
          ? true
          : source.workspaceMode === "current"
            ? false
            : undefined,
    });
    const previous = stored ? (JSON.parse(String(stored.value)) as HostAutomation) : undefined;
    const automation: HostAutomation = {
      ...input,
      enabled: proof.phase === "committed" && source.enabled,
      nextRunAt: source.nextRunAt,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
      lastRunAt: typeof source.lastRunAt === "number" ? source.lastRunAt : undefined,
      lastRunStatus: source.lastRunStatus as HostAutomation["lastRunStatus"],
      lastRunError: typeof source.lastRunError === "string" ? source.lastRunError : undefined,
      // Native session IDs belong to the archived native history, never Host sessions.
      nativeMigrationState: {
        receipt: proof.receipt,
        fingerprint,
        phase: proof.phase,
        sourceAutomationId: proof.automationId,
      },
    };
    if (
      previous?.nativeMigrationState?.fingerprint !== undefined &&
      previous.nativeMigrationState.fingerprint !== fingerprint
    )
      throw new Error("Prepared migration configuration changed.");
    await store.db
      .prepare(
        "INSERT INTO automations(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(id, JSON.stringify(automation));
    await store.db
      .prepare(
        "INSERT INTO automation_native_migrations(receipt,automation_id,fingerprint,snapshot,phase,source_automation_id) VALUES(?,?,?,?,?,?) ON CONFLICT(receipt) DO UPDATE SET phase=excluded.phase",
      )
      .run(proof.receipt, id, fingerprint, proof.snapshot, proof.phase, proof.automationId);
    if (!existing)
      for (const run of snapshot.runs) {
        const history: HostAutomationRun = {
          id: `native-${digest(`${proof.receipt}:${run.id}`).slice(0, 40)}`,
          automationId: id,
          trigger:
            run.trigger === "manual" ? "manual" : run.trigger === "event" ? "event" : "scheduled",
          scheduledFor: run.scheduledFor,
          createdAt: run.createdAt,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          status: run.status,
          error: run.error,
          nativeRunId: run.id,
          nativeSessionId: run.sessionId,
        };
        await store.db
          .prepare("INSERT INTO automation_runs(id,automation_id,created_at,value) VALUES(?,?,?,?)")
          .run(history.id, id, history.createdAt, JSON.stringify(history));
      }
    return automation;
  });
}
