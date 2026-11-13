import { createHash } from "node:crypto";
import type { HostStore } from "../store";
import type { HostAutomation } from "../../src/features/automations/model/hostAutomations";
import type { HostSteward } from "../../src/features/tasks/model/hostStewards";

export const projectScanAutomationId = (id: string) =>
  `scan-${createHash("sha256").update(id).digest("hex").slice(0, 40)}`;

/** Keep original definitions, proposals and history. Receipt gates legacy scheduling. */
export async function migrateSteward(
  store: HostStore,
  steward: HostSteward,
  refresh = false,
): Promise<string> {
  return store.transaction(async () => {
    await store.db.exec(
      "CREATE TABLE IF NOT EXISTS steward_automation_migrations (steward_id TEXT PRIMARY KEY, automation_id TEXT NOT NULL UNIQUE, original_value TEXT NOT NULL)",
    );
    const receipt = await store.db
      .prepare("SELECT automation_id FROM steward_automation_migrations WHERE steward_id=?")
      .get(steward.id);
    const id = receipt ? String(receipt.automation_id) : projectScanAutomationId(steward.id);
    const row = await store.db.prepare("SELECT value FROM automations WHERE id=?").get(id);
    if (receipt && !refresh) return id;
    if (!receipt && row) throw new Error("Project scan automation identity is already occupied.");
    const previous = row ? (JSON.parse(String(row.value)) as HostAutomation) : undefined;
    const automation: HostAutomation = {
      id,
      template: { kind: "project-scan", sourceStewardId: steward.id },
      name: "Project scan",
      prompt: steward.focus || "Inspect project and propose next work.",
      projectId: steward.projectId,
      harness: steward.harness,
      providerAccountId: steward.providerAccountId,
      modelChoice: steward.modelChoice,
      model: steward.model,
      modelSettings: steward.modelSettings,
      runtimeMode: steward.runtimeMode,
      isolate: steward.isolate,
      maxRunMinutes: 20,
      maxRunsPerDay: 0,
      enabled: steward.enabled,
      scheduleKind: steward.scheduleKind,
      minute: steward.minute,
      time: steward.time,
      dayOfWeek: steward.dayOfWeek,
      nextRunAt: steward.nextRunAt,
      createdAt: previous?.createdAt ?? steward.createdAt,
      updatedAt: steward.updatedAt,
      lastRunAt: previous?.lastRunAt ?? steward.lastRunAt,
      lastRunStatus: previous?.lastRunStatus ?? steward.lastRunStatus,
      lastRunError: previous?.lastRunError ?? steward.lastRunError,
      lastSessionId: previous?.lastSessionId ?? steward.lastSessionId,
    };
    await store.db
      .prepare(
        "INSERT INTO automations(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(id, JSON.stringify(automation));
    if (!receipt)
      await store.db
        .prepare(
          "INSERT INTO steward_automation_migrations(steward_id,automation_id,original_value) VALUES(?,?,?)",
        )
        .run(steward.id, id, JSON.stringify(steward));
    return id;
  });
}
